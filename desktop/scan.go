// Scan d'objet : Ctrl+D (à fabriquer) ou Ctrl+F (« j'en ai ») au-dessus d'un objet dans WAKFU.
//
// L'appli ne touche pas au jeu : elle fait une capture d'écran locale autour de la souris,
// la lit avec la reconnaissance de texte intégrée à Windows (Windows.Media.Ocr, via PowerShell),
// et envoie les lignes lues à la page, qui retrouve l'objet dans data_item.json.
// Les raccourcis ne sont enregistrés que lorsque la fenêtre de WAKFU est au premier plan :
// Ctrl+D et Ctrl+F gardent leur rôle habituel dans les autres applis.

package main

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

//go:embed ocr.ps1
var ocrScript []byte

var (
	gdi32 = windows.NewLazySystemDLL("gdi32.dll")

	procRegisterHotKey   = user32.NewProc("RegisterHotKey")
	procUnregisterHotKey = user32.NewProc("UnregisterHotKey")
	procPeekMessageW     = user32.NewProc("PeekMessageW")
	procGetCursorPos     = user32.NewProc("GetCursorPos")
	procGetWindowTextW   = user32.NewProc("GetWindowTextW")
	procGetDC            = user32.NewProc("GetDC")
	procReleaseDC        = user32.NewProc("ReleaseDC")

	procCreateCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	procCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	procSelectObject           = gdi32.NewProc("SelectObject")
	procBitBlt                 = gdi32.NewProc("BitBlt")
	procGetDIBits              = gdi32.NewProc("GetDIBits")
	procDeleteObject           = gdi32.NewProc("DeleteObject")
	procDeleteDC               = gdi32.NewProc("DeleteDC")
)

const (
	hotkeyID     = 0x5743 // « WC » : Ctrl+D, objet à fabriquer
	hotkeyHaveID = 0x5744 // Ctrl+F : ressource à ajouter à « j'ai »
	hotkeyHsID   = 0x5745 // Ctrl+H : relevé de l'onglet du coffre de havre-sac affiché
	modControl   = 0x0002
	modNoRepeat  = 0x4000
	vkD          = 0x44
	vkF          = 0x46
	vkH          = 0x48
	wmHotkey     = 0x0312
	pmRemove     = 0x0001
	srcCopy      = 0x00CC0020
	captureBlt   = 0x40000000
	smXVirtual   = 76
	smYVirtual   = 77
	smCXVirtual  = 78
	smCYVirtual  = 79
	dibRGBColors = 0
)

type point struct{ X, Y int32 }

type winMsg struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      point
	_       uint32
}

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

// scanResult est envoyé à la page (window.wfScan).
type scanResult struct {
	Pending bool     `json:"pending,omitempty"`
	Mode    string   `json:"mode,omitempty"` // "have" pour Ctrl+F
	Lines   []string `json:"lines,omitempty"`
	Error   string   `json:"error,omitempty"`
	Capture string   `json:"capture,omitempty"` // Ctrl+H : adresse de la capture de la fenêtre du jeu (serveur local)
}

// Dernière capture de la fenêtre du jeu (Ctrl+H), servie à la page sur /capture.png.
var (
	captureMu  sync.Mutex
	capturePNG []byte
	captureN   int
)

func lastCapture() []byte {
	captureMu.Lock()
	defer captureMu.Unlock()
	return capturePNG
}

var scanEnabled atomic.Bool

// startScanHotkey lance la boucle du raccourci dans son propre thread Windows.
// send est appelé (depuis ce thread) avec chaque résultat à transmettre à la page.
func startScanHotkey(self uintptr, send func(scanResult)) {
	scanEnabled.Store(true)
	go func() {
		runtime.LockOSThread() // RegisterHotKey(NULL) poste WM_HOTKEY dans la file de CE thread
		registered := false
		var busy atomic.Bool
		var msg winMsg
		for {
			want := scanEnabled.Load() && wakfuInFront(self)
			if want && !registered {
				r, _, _ := procRegisterHotKey.Call(0, hotkeyID, modControl|modNoRepeat, vkD)
				r2, _, _ := procRegisterHotKey.Call(0, hotkeyHaveID, modControl|modNoRepeat, vkF)
				procRegisterHotKey.Call(0, hotkeyHsID, modControl|modNoRepeat, vkH)
				registered = r != 0 || r2 != 0
				hotkeyOK.Store(registered)
				regFailed.Store(r == 0 || r2 == 0)
			} else if !want && registered {
				procUnregisterHotKey.Call(0, hotkeyID)
				procUnregisterHotKey.Call(0, hotkeyHaveID)
				procUnregisterHotKey.Call(0, hotkeyHsID)
				registered = false
				hotkeyOK.Store(false)
			}
			for {
				r, _, _ := procPeekMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0, pmRemove)
				if r == 0 {
					break
				}
				if msg.Message == wmHotkey && msg.WParam == hotkeyHsID && busy.CompareAndSwap(false, true) {
					// Ctrl+H : toute la fenêtre du jeu, lue ensuite par la page (web/js/havresac.js).
					// Capture d'abord, puis ouverture de la petite fenêtre de scan (sinon elle serait sur la capture).
					rememberScanOrigin()
					img, err := captureGameWindow()
					send(scanResult{Pending: true, Mode: "coffre"})
					go func() {
						defer busy.Store(false)
						if err != nil {
							send(scanResult{Error: "Capture d'écran impossible : " + err.Error(), Mode: "coffre"})
							return
						}
						var buf bytes.Buffer
						if err := (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(&buf, img); err != nil {
							send(scanResult{Error: err.Error(), Mode: "coffre"})
							return
						}
						captureMu.Lock()
						capturePNG = buf.Bytes()
						captureN++
						n := captureN
						captureMu.Unlock()
						send(scanResult{Mode: "coffre", Capture: fmt.Sprintf("/capture.png?n=%d", n)})
					}()
				}
				if msg.Message == wmHotkey && (msg.WParam == hotkeyID || msg.WParam == hotkeyHaveID) && busy.CompareAndSwap(false, true) {
					mode := ""
					if msg.WParam == hotkeyHaveID {
						mode = "have"
					}
					// capture AVANT d'ouvrir le panneau de scan : sinon il recouvre l'infobulle
					// (et la capture peut échouer pendant que la fenêtre change de forme)
					rememberScanOrigin()
					img, err := captureAroundCursor()
					send(scanResult{Pending: true, Mode: mode})
					go func() {
						if err != nil {
							send(scanResult{Error: "Capture d'écran impossible : " + err.Error(), Mode: mode})
						} else {
							r := readImage(img)
							r.Mode = mode
							send(r)
						}
						busy.Store(false)
					}()
				}
			}
			time.Sleep(60 * time.Millisecond)
		}
	}()
}

// fgInfo décrit la dernière fenêtre (hors Wak'Forge) passée au premier plan : affiché dans Réglages
// pour vérifier que le jeu est bien reconnu.
type fgInfo struct {
	Exe        string `json:"exe"`
	Path       string `json:"path"`
	Title      string `json:"title"`
	Game       bool   `json:"game"`
	Registered bool   `json:"registered"`
	RegFailed  bool   `json:"regFailed"`
	Enabled    bool   `json:"enabled"`
}

var (
	lastFgMu  sync.Mutex
	lastFg    fgInfo
	hotkeyOK  atomic.Bool
	regFailed atomic.Bool // Windows a refusé Ctrl+D ou Ctrl+F (déjà pris par un autre programme)
)

func scanStatus() fgInfo {
	lastFgMu.Lock()
	defer lastFgMu.Unlock()
	st := lastFg
	st.Registered = hotkeyOK.Load()
	st.Enabled = scanEnabled.Load()
	st.RegFailed = regFailed.Load()
	return st
}

// isGame dit si un programme et un titre de fenêtre correspondent au client WAKFU.
// Le client est un programme Java : il tourne sous jre\bin\javaw.exe, dans le dossier
// d'installation du jeu (par défaut %LOCALAPPDATA%\Ankama\Wakfu). On reconnaît donc
// le jeu au chemin du programme ; à défaut, à un programme Java dont la fenêtre s'appelle WAKFU.
func isGame(path, title string) bool {
	p := strings.ToLower(strings.ReplaceAll(path, "/", `\`))
	exe := p[strings.LastIndex(p, `\`)+1:]
	if strings.Contains(p, `\wakfu\`) || strings.Contains(exe, "wakfu") {
		return true
	}
	isJava := exe == "javaw.exe" || exe == "java.exe"
	return isJava && strings.Contains(strings.ToLower(title), "wakfu")
}

// wakfuInFront indique si la fenêtre au premier plan est celle du jeu.
func wakfuInFront(self uintptr) bool {
	h := windows.GetForegroundWindow()
	if h == 0 || uintptr(h) == self {
		return false
	}
	path := ""
	var pid uint32
	if _, err := windows.GetWindowThreadProcessId(h, &pid); err == nil && pid != 0 {
		if p, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid); err == nil {
			buf := make([]uint16, 1024)
			n := uint32(len(buf))
			if windows.QueryFullProcessImageName(p, 0, &buf[0], &n) == nil {
				path = windows.UTF16ToString(buf[:n])
			}
			windows.CloseHandle(p)
		}
	}
	tbuf := make([]uint16, 256)
	procGetWindowTextW.Call(uintptr(h), uintptr(unsafe.Pointer(&tbuf[0])), uintptr(len(tbuf)))
	title := strings.TrimSpace(windows.UTF16ToString(tbuf))
	game := isGame(path, title)
	lastFgMu.Lock()
	lastFg = fgInfo{Exe: filepath.Base(path), Path: path, Title: title, Game: game}
	lastFgMu.Unlock()
	return game
}

// captureGameWindow capture la fenêtre du jeu au premier plan (coffre de havre-sac ouvert).
func captureGameWindow() (*image.RGBA, error) {
	h := windows.GetForegroundWindow()
	if h == 0 {
		return nil, errors.New("fenêtre du jeu introuvable")
	}
	r := windowRect(uintptr(h))
	w, ht := int(r.R-r.L), int(r.B-r.T)
	if w < 200 || ht < 200 {
		return nil, errors.New("fenêtre du jeu trop petite")
	}
	var err error
	for try := 0; try < 3; try++ {
		var img *image.RGBA
		if img, err = captureScreen(int(r.L), int(r.T), w, ht); err == nil {
			return img, nil
		}
		time.Sleep(40 * time.Millisecond)
	}
	return nil, err
}

// captureAroundCursor capture la zone autour de la souris. Appelée depuis le fil du raccourci
// (verrouillé sur un fil Windows) ; un échec ponctuel de GDI est retenté.
func captureAroundCursor() (*image.RGBA, error) {
	var pt point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))

	// zone large : l'infobulle de l'objet peut s'afficher d'un côté ou de l'autre du curseur
	vx, _, _ := procGetSystemMetrics.Call(smXVirtual)
	vy, _, _ := procGetSystemMetrics.Call(smYVirtual)
	vw, _, _ := procGetSystemMetrics.Call(smCXVirtual)
	vh, _, _ := procGetSystemMetrics.Call(smCYVirtual)
	minX, minY := int(int32(vx)), int(int32(vy))
	maxX, maxY := minX+int(int32(vw)), minY+int(int32(vh))
	w, h := int(dpiScale(900)), int(dpiScale(760))
	if w > maxX-minX {
		w = maxX - minX
	}
	if h > maxY-minY {
		h = maxY - minY
	}
	x := clamp(int(pt.X)-w/2, minX, maxX-w)
	y := clamp(int(pt.Y)-int(dpiScale(360)), minY, maxY-h)

	var err error
	for try := 0; try < 3; try++ {
		var img *image.RGBA
		if img, err = captureScreen(x, y, w, h); err == nil {
			return img, nil
		}
		time.Sleep(40 * time.Millisecond)
	}
	return nil, err
}

// readImage lit le texte de la capture avec l'OCR de Windows.
func readImage(img *image.RGBA) scanResult {
	img = upscale2x(img) // le texte des infobulles est petit : l'OCR lit mieux en plus grand

	dir := filepath.Join(os.TempDir(), "WakForge")
	_ = os.MkdirAll(dir, 0o755)
	imgPath := filepath.Join(dir, "scan.png")
	scriptPath := filepath.Join(dir, "ocr.ps1")
	defer os.Remove(imgPath)
	f, err := os.Create(imgPath)
	if err != nil {
		return scanResult{Error: err.Error()}
	}
	err = png.Encode(f, img)
	f.Close()
	if err != nil {
		return scanResult{Error: err.Error()}
	}
	if err := os.WriteFile(scriptPath, ocrScript, 0o644); err != nil {
		return scanResult{Error: err.Error()}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, imgPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if ee, ok := err.(*exec.ExitError); ok && len(ee.Stderr) > 0 {
			msg = strings.TrimSpace(string(ee.Stderr))
		}
		if msg == "" {
			msg = err.Error()
		}
		return scanResult{Error: "Lecture du texte impossible : " + msg}
	}
	var lines []string
	for _, l := range strings.Split(strings.TrimPrefix(string(out), "\ufeff"), "\n") {
		if l = strings.TrimSpace(l); l != "" {
			lines = append(lines, l)
		}
	}
	return scanResult{Lines: lines}
}

func clamp(v, lo, hi int) int {
	if v > hi {
		v = hi
	}
	if v < lo {
		v = lo
	}
	return v
}

func captureScreen(x, y, w, h int) (*image.RGBA, error) {
	screen, _, _ := procGetDC.Call(0)
	if screen == 0 {
		return nil, errors.New("écran inaccessible (GetDC)")
	}
	defer procReleaseDC.Call(0, screen)
	mem, _, _ := procCreateCompatibleDC.Call(screen)
	defer procDeleteDC.Call(mem)
	bmp, _, _ := procCreateCompatibleBitmap.Call(screen, uintptr(w), uintptr(h))
	if bmp == 0 {
		return nil, errors.New("mémoire insuffisante (CreateCompatibleBitmap)")
	}
	defer procDeleteObject.Call(bmp)
	old, _, _ := procSelectObject.Call(mem, bmp)
	ok, _, _ := procBitBlt.Call(mem, 0, 0, uintptr(w), uintptr(h), screen, uintptr(x), uintptr(y), srcCopy|captureBlt)
	procSelectObject.Call(mem, old)
	if ok == 0 {
		return nil, errors.New("copie de l'écran refusée (BitBlt)")
	}

	hdr := bitmapInfoHeader{Width: int32(w), Height: -int32(h), Planes: 1, BitCount: 32}
	hdr.Size = uint32(unsafe.Sizeof(hdr))
	buf := make([]byte, w*h*4)
	r, _, _ := procGetDIBits.Call(mem, bmp, 0, uintptr(h), uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&hdr)), dibRGBColors)
	if r == 0 {
		return nil, errors.New("lecture de l'image refusée (GetDIBits)")
	}
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < len(buf); i += 4 { // BGRA -> RGBA
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = buf[i+2], buf[i+1], buf[i], 255
	}
	return img, nil
}

// upscale2x agrandit l'image ×2 (interpolation bilinéaire).
func upscale2x(src *image.RGBA) *image.RGBA {
	sw, sh := src.Rect.Dx(), src.Rect.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, sw*2, sh*2))
	for y := 0; y < sh*2; y++ {
		fy := float64(y)/2 - 0.25
		y0 := clamp(int(fy), 0, sh-1)
		y1 := clamp(y0+1, 0, sh-1)
		ty := fy - float64(y0)
		if ty < 0 {
			ty = 0
		}
		for x := 0; x < sw*2; x++ {
			fx := float64(x)/2 - 0.25
			x0 := clamp(int(fx), 0, sw-1)
			x1 := clamp(x0+1, 0, sw-1)
			tx := fx - float64(x0)
			if tx < 0 {
				tx = 0
			}
			d := dst.PixOffset(x, y)
			for c := 0; c < 3; c++ {
				p00 := float64(src.Pix[src.PixOffset(x0, y0)+c])
				p10 := float64(src.Pix[src.PixOffset(x1, y0)+c])
				p01 := float64(src.Pix[src.PixOffset(x0, y1)+c])
				p11 := float64(src.Pix[src.PixOffset(x1, y1)+c])
				v := (p00*(1-tx)+p10*tx)*(1-ty) + (p01*(1-tx)+p11*tx)*ty
				dst.Pix[d+c] = uint8(v + 0.5)
			}
			dst.Pix[d+3] = 255
		}
	}
	return dst
}

func scanJSON(r scanResult) string {
	b, _ := json.Marshal(r)
	return string(b)
}
