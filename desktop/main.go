// Wak'Forge – craft, bestiaire et timers d'archimonstres Wakfu, appli PC.
//
// Affiche l'appli web (dossier web/, embarqué dans l'exe) dans une fenêtre native WebView2
// et gère ce qu'un navigateur fait mal fenêtre réduite : alertes à l'heure pile, notification
// Windows, son, mise au premier plan.
//
// Compilation : voir build.sh (ou le workflow GitHub Actions).
package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

//go:embed all:web
var webFS embed.FS

// Port fixe : l'adresse (donc le stockage local du site) reste la même d'un lancement à l'autre.
const port = 47816

var version = "dev"

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")
	shell32  = windows.NewLazySystemDLL("shell32.dll")

	procMessageBoxW      = user32.NewProc("MessageBoxW")
	procFindWindowW      = user32.NewProc("FindWindowW")
	procShowWindow       = user32.NewProc("ShowWindow")
	procSetForeground    = user32.NewProc("SetForegroundWindow")
	procIsIconic         = user32.NewProc("IsIconic")
	procSetWindowPos     = user32.NewProc("SetWindowPos")
	procFlashWindowEx    = user32.NewProc("FlashWindowEx")
	procLoadImageW       = user32.NewProc("LoadImageW")
	procGetSystemMetrics = user32.NewProc("GetSystemMetrics")
	procGetDpiForSystem  = user32.NewProc("GetDpiForSystem")
	procGetWindowRect    = user32.NewProc("GetWindowRect")
	procMoveWindow       = user32.NewProc("MoveWindow")
	procIsZoomed         = user32.NewProc("IsZoomed")
	procGetWindowLongW   = user32.NewProc("GetWindowLongW")
	procSetWindowLongW   = user32.NewProc("SetWindowLongW")
	procSetLayeredAttrs  = user32.NewProc("SetLayeredWindowAttributes")
	procSystemParamsInfo = user32.NewProc("SystemParametersInfoW")
	procBeep             = kernel32.NewProc("Beep")
	procShellNotifyIconW = shell32.NewProc("Shell_NotifyIconW")
)

const (
	swRestore       = 9
	swShow          = 5
	swpNoSize       = 0x0001
	swpNoMove       = 0x0002
	swpNoActivate   = 0x0010
	hwndTopmost     = ^uintptr(0) // -1
	hwndNotTopmost  = ^uintptr(1) // -2
	flashwAll       = 0x3
	flashwTimerNoFG = 0xC
)

func messageBox(text, title string, flags uintptr) {
	t, _ := windows.UTF16PtrFromString(text)
	c, _ := windows.UTF16PtrFromString(title)
	procMessageBoxW.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), flags)
}

func appDataDir() string {
	base := os.Getenv("APPDATA")
	if base == "" {
		base = os.TempDir()
	}
	dir := filepath.Join(base, "WakForge")
	// Anciens noms de l'appli (Wak'Up, Minuteur Archimonstres) : on reprend leurs données au premier lancement.
	for _, old := range []string{"WakUp", "MinuteurArchimonstres"} {
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			break
		}
		_ = os.Rename(filepath.Join(base, old), dir)
	}
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

func exeDir() string {
	p, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(p)
}

func dpiScale(v uint) uint {
	if procGetDpiForSystem.Find() != nil {
		return v
	}
	dpi, _, _ := procGetDpiForSystem.Call()
	if dpi < 96 {
		return v
	}
	return v * uint(dpi) / 96
}

// ------------------------------------------------------------------ serveur local

func startServer() error {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return err
	}
	sub, _ := fs.Sub(webFS, "web")
	files := http.FileServer(http.FS(sub))
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		// config.js peut être remplacé sans recompiler : un fichier config.js posé à côté de
		// l'exe (ou dans %APPDATA%\WakForge) est prioritaire.
		if r.URL.Path == "/js/config.js" {
			for _, dir := range []string{exeDir(), appDataDir()} {
				if b, err := os.ReadFile(filepath.Join(dir, "config.js")); err == nil {
					w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
					_, _ = w.Write(b)
					return
				}
			}
		}
		if r.URL.Path == "/capture.png" { // dernière capture Ctrl+H (coffre de havre-sac)
			b := lastCapture()
			if b == nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(b)
			return
		}
		if strings.HasSuffix(r.URL.Path, ".webmanifest") {
			w.Header().Set("Content-Type", "application/manifest+json")
		}
		files.ServeHTTP(w, r)
	})
	go func() { _ = http.Serve(ln, mux) }()
	return nil
}

// ------------------------------------------------------------------ zone de notification

type notifyIconData struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GUIDItem         windows.GUID
	HBalloonIcon     uintptr
}

const (
	nimAdd    = 0
	nimModify = 1
	nimDelete = 2
	nifIcon   = 0x2
	nifTip    = 0x4
	nifInfo   = 0x10
	niifUser  = 0x4
	niifLarge = 0x20
)

type tray struct {
	nid   notifyIconData
	added bool
}

func copyUTF16(dst []uint16, s string) {
	u, _ := windows.UTF16FromString(s)
	if len(u) > len(dst) {
		u = u[:len(dst)]
		u[len(u)-1] = 0
	}
	copy(dst, u)
}

func newTray(hwnd uintptr) *tray {
	t := &tray{}
	var hinst windows.Handle
	_ = windows.GetModuleHandleEx(0, nil, &hinst)
	cx, _, _ := procGetSystemMetrics.Call(49) // SM_CXSMICON
	cy, _, _ := procGetSystemMetrics.Call(50)
	icon, _, _ := procLoadImageW.Call(uintptr(hinst), 2, 1, cx, cy, 0) // icône n°2 (voir winres)
	t.nid.CbSize = uint32(unsafe.Sizeof(t.nid))
	t.nid.HWnd = hwnd
	t.nid.UID = 1
	t.nid.UFlags = nifIcon | nifTip
	t.nid.HIcon = icon
	copyUTF16(t.nid.SzTip[:], "Wak'Forge")
	r, _, _ := procShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&t.nid)))
	t.added = r != 0
	return t
}

func (t *tray) balloon(title, body string) {
	if !t.added {
		return
	}
	t.nid.UFlags = nifInfo
	t.nid.SzInfo = [256]uint16{}
	t.nid.SzInfoTitle = [64]uint16{}
	copyUTF16(t.nid.SzInfoTitle[:], title)
	copyUTF16(t.nid.SzInfo[:], body)
	t.nid.DwInfoFlags = niifUser | niifLarge
	t.nid.HBalloonIcon = t.nid.HIcon
	procShellNotifyIconW.Call(nimModify, uintptr(unsafe.Pointer(&t.nid)))
}

func (t *tray) remove() {
	if t.added {
		procShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&t.nid)))
	}
}

// ------------------------------------------------------------------ fenêtre

type flashInfo struct {
	CbSize    uint32
	Hwnd      uintptr
	DwFlags   uint32
	UCount    uint32
	DwTimeout uint32
}

var topmost bool

func setTopmost(hwnd uintptr, on bool) {
	topmost = on
	if inOverlay {
		return // l'overlay reste au premier plan ; le réglage s'appliquera en le quittant
	}
	after := hwndNotTopmost
	if on {
		after = hwndTopmost
	}
	procSetWindowPos.Call(hwnd, after, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate)
}

// ------------------------------------------------------------------ mode overlay

// En mode overlay, la fenêtre devient petite, reste au premier plan et peut être
// semi-transparente, pour garder la liste de courses par-dessus le jeu.

type rect struct{ L, T, R, B int32 }

const (
	gwlExStyle     = ^uintptr(19) // GWL_EXSTYLE (-20)
	wsExLayered    = 0x00080000
	lwaAlpha       = 0x2
	spiGetWorkArea = 0x0030
)

var (
	inOverlay   bool
	normalRect  rect
	overlayRect rect
)

func windowRect(hwnd uintptr) rect {
	var r rect
	procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	return r
}

func moveTo(hwnd uintptr, r rect) {
	procMoveWindow.Call(hwnd, uintptr(int(r.L)), uintptr(int(r.T)), uintptr(int(r.R-r.L)), uintptr(int(r.B-r.T)), 1)
}

func setOpacity(hwnd uintptr, alpha int) {
	style, _, _ := procGetWindowLongW.Call(hwnd, gwlExStyle)
	if alpha >= 255 || alpha <= 0 {
		procSetWindowLongW.Call(hwnd, gwlExStyle, style&^wsExLayered)
		return
	}
	if alpha < 60 {
		alpha = 60
	}
	procSetWindowLongW.Call(hwnd, gwlExStyle, style|wsExLayered)
	procSetLayeredAttrs.Call(hwnd, 0, uintptr(alpha), lwaAlpha)
}

func setOverlay(hwnd uintptr, on bool, alpha int) {
	if on == inOverlay {
		if on {
			setOpacity(hwnd, alpha)
		}
		return
	}
	if on {
		if z, _, _ := procIsZoomed.Call(hwnd); z != 0 {
			procShowWindow.Call(hwnd, swRestore)
		}
		normalRect = windowRect(hwnd)
		if overlayRect.R == overlayRect.L {
			var wa rect
			procSystemParamsInfo.Call(spiGetWorkArea, 0, uintptr(unsafe.Pointer(&wa)), 0)
			w, h, m := int32(dpiScale(380)), int32(dpiScale(620)), int32(dpiScale(16))
			overlayRect = rect{L: wa.R - w - m, T: wa.T + m*5, R: wa.R - m, B: wa.T + m*5 + h}
		}
		moveTo(hwnd, overlayRect)
		procSetWindowPos.Call(hwnd, hwndTopmost, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate)
		setOpacity(hwnd, alpha)
	} else {
		overlayRect = windowRect(hwnd)
		setOpacity(hwnd, 255)
		moveTo(hwnd, normalRect)
		after := hwndNotTopmost
		if topmost {
			after = hwndTopmost
		}
		procSetWindowPos.Call(hwnd, after, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate)
	}
	inOverlay = on
}

func attention(hwnd uintptr) {
	fi := flashInfo{Hwnd: hwnd, DwFlags: flashwAll | flashwTimerNoFG}
	fi.CbSize = uint32(unsafe.Sizeof(fi))
	procFlashWindowEx.Call(uintptr(unsafe.Pointer(&fi)))
	if r, _, _ := procIsIconic.Call(hwnd); r != 0 {
		procShowWindow.Call(hwnd, swRestore)
	}
	procSetWindowPos.Call(hwnd, hwndTopmost, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate)
	if !topmost && !inOverlay {
		time.AfterFunc(2500*time.Millisecond, func() {
			if !topmost && !inOverlay {
				procSetWindowPos.Call(hwnd, hwndNotTopmost, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate)
			}
		})
	}
}

func chime() {
	for i := 0; i < 2; i++ {
		for _, f := range []uintptr{784, 1047, 1319} {
			procBeep.Call(f, 140)
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// ------------------------------------------------------------------ alertes programmées

type alarm struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	At    int64  `json:"at"` // millisecondes depuis 1970
}

type scheduler struct {
	mu     sync.Mutex
	timers map[string]*time.Timer
	fired  map[string]bool
}

func (s *scheduler) set(items []alarm, sound bool, fire func(alarm, bool)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.timers {
		t.Stop()
	}
	s.timers = map[string]*time.Timer{}
	for _, it := range items {
		it := it
		d := time.Until(time.UnixMilli(it.At))
		if d <= 0 || s.fired[it.ID] {
			continue
		}
		s.timers[it.ID] = time.AfterFunc(d, func() {
			s.mu.Lock()
			already := s.fired[it.ID]
			s.fired[it.ID] = true
			s.mu.Unlock()
			if !already {
				fire(it, sound)
			}
		})
	}
}

// ------------------------------------------------------------------ main

func focusExisting() {
	cls, _ := windows.UTF16PtrFromString("webview")
	title, _ := windows.UTF16PtrFromString("Wak'Forge – Craft & bestiaire Wakfu")
	h, _, _ := procFindWindowW.Call(uintptr(unsafe.Pointer(cls)), uintptr(unsafe.Pointer(title)))
	if h != 0 {
		procShowWindow.Call(h, swRestore)
		procShowWindow.Call(h, swShow)
		procSetForeground.Call(h)
	}
}

func main() {
	// après une mise à jour, l'ancienne version met quelques instants à se fermer : on l'attend
	tries := 1
	if justUpdated() {
		tries = 50
		go cleanupOld()
	}
	name, _ := windows.UTF16PtrFromString("WakForgeWakfu.Instance")
	var mutex windows.Handle
	for i := 0; ; i++ {
		m, err := windows.CreateMutex(nil, false, name)
		if err != windows.ERROR_ALREADY_EXISTS {
			mutex = m
			break
		}
		if m != 0 {
			windows.CloseHandle(m)
		}
		if i+1 >= tries {
			focusExisting()
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	if mutex != 0 {
		defer windows.CloseHandle(mutex)
	}

	err := startServer()
	for i := 1; err != nil && i < tries; i++ {
		time.Sleep(200 * time.Millisecond)
		err = startServer()
	}
	if err != nil {
		messageBox(fmt.Sprintf("Impossible de démarrer : le port %d est déjà utilisé.\n\n%v", port, err),
			"Wak'Forge", 0x10)
		return
	}

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath:  filepath.Join(appDataDir(), "WebView2"),
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  "Wak'Forge – Craft & bestiaire Wakfu",
			Width:  dpiScale(1120),
			Height: dpiScale(800),
			IconId: 2,
			Center: true,
		},
	})
	if w == nil {
		messageBox("Le composant Microsoft Edge WebView2 est introuvable.\n\n"+
			"Il est inclus dans Windows 10 et 11 à jour. Sinon, installe-le depuis :\n"+
			"https://developer.microsoft.com/microsoft-edge/webview2/",
			"Wak'Forge", 0x10)
		return
	}
	defer w.Destroy()

	hwnd := uintptr(w.Window())
	tr := newTray(hwnd)
	defer tr.remove()
	sched := &scheduler{fired: map[string]bool{}}

	fire := func(a alarm, sound bool) {
		if sound {
			go chime()
		}
		w.Dispatch(func() {
			tr.balloon(a.Title, "Wak'Forge")
			attention(hwnd)
		})
	}

	_ = w.Bind("nativeSchedule", func(items []alarm, sound bool) {
		sched.set(items, sound, fire)
	})
	_ = w.Bind("nativeSetTopmost", func(on bool) {
		w.Dispatch(func() { setTopmost(hwnd, on) })
	})
	_ = w.Bind("nativeOverlay", func(on bool, alpha int) {
		w.Dispatch(func() { setOverlay(hwnd, on, alpha) })
	})
	_ = w.Bind("nativeNotify", func(title, body string) {
		w.Dispatch(func() { tr.balloon(title, body) })
	})
	_ = w.Bind("nativeVersion", func() string { return version })
	_ = w.Bind("nativeOpenURL", func(url string) { openURL(url) })
	// mise à jour : téléchargement + remplacement de l'exe (en arrière-plan, la fenêtre reste
	// utilisable), puis relance de la nouvelle version ; un échec est renvoyé à la page
	_ = w.Bind("nativeUpdate", func(url string) {
		go func() {
			exe, err := selfUpdate(url)
			if err == nil {
				if err = relaunch(exe); err != nil {
					err = fmt.Errorf("nouvelle version installée, mais le redémarrage a échoué : relance Wak'Forge (%v)", err)
				}
			}
			w.Dispatch(func() {
				if err != nil {
					msg, _ := json.Marshal(err.Error())
					w.Eval("window.wfUpdateFailed && window.wfUpdateFailed(" + string(msg) + ")")
					return
				}
				w.Terminate()
			})
		}()
	})

	// scan d'objet (Ctrl+D dans le jeu) : résultat transmis à la page, et petite fenêtre séparée
	// ouverte à côté de la souris pour choisir la rareté et la quantité (la fenêtre principale ne bouge pas)
	scanWin := newScanWindow(w, hwnd)
	startScanHotkey(hwnd, func(r scanResult) {
		js := "window.wfScan && window.wfScan(" + scanJSON(r) + ")"
		w.Dispatch(func() {
			if r.Pending && scanWin != nil {
				scanWin.open()
			}
			w.Eval(js)
		})
	})
	_ = w.Bind("nativeScanEnable", func(on bool) { scanEnabled.Store(on) })
	_ = w.Bind("nativeScanStatus", func() fgInfo { return scanStatus() })
	_ = w.Bind("nativeScanShow", func(state json.RawMessage) {
		w.Dispatch(func() {
			if scanWin != nil {
				scanWin.show(state)
			}
		})
	})

	w.Navigate(fmt.Sprintf("http://127.0.0.1:%d/", port))
	w.Run()
}
