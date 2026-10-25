// Fenêtre de scan : après Ctrl+D, une petite fenêtre séparée (WebView2, page scan.html) s'ouvre
// à côté de la souris, au premier plan, pour choisir la rareté et la quantité de l'objet scanné.
// La fenêtre principale ne bouge jamais : l'objet est ajouté à la liste en arrière-plan
// (ou dans l'overlay s'il est affiché), et le jeu retrouve le focus.

package main

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

var (
	procMonitorFromPoint  = user32.NewProc("MonitorFromPoint")
	procGetMonitorInfoW   = user32.NewProc("GetMonitorInfoW")
	procAttachThreadInput = user32.NewProc("AttachThreadInput")
	procBringWindowToTop  = user32.NewProc("BringWindowToTop")
	procSetWindowLongPtrW = user32.NewProc("SetWindowLongPtrW")
	procCallWindowProcW   = user32.NewProc("CallWindowProcW")
	procIsWindowVisible   = user32.NewProc("IsWindowVisible")
)

const (
	gwlStyle             = ^uintptr(15) // GWL_STYLE (-16)
	gwlpWndProc          = ^uintptr(3)  // GWLP_WNDPROC (-4)
	wsPopup              = 0x80000000
	wsExToolWindow       = 0x00000080
	wsExTopmost          = 0x00000008
	swpFrameChanged      = 0x0020
	swpShowWindow        = 0x0040
	swHide               = 0
	wmClose              = 0x0010
	wmActivate           = 0x0006
	monitorDefaultToNear = 2
)

type monitorInfo struct {
	CbSize    uint32
	RcMonitor rect
	RcWork    rect
	DwFlags   uint32
}

// position de la souris et fenêtre au premier plan (le jeu) au moment du Ctrl+D
var (
	scanOriginMu sync.Mutex
	scanOrigin   point
	scanPrevFg   uintptr
)

func rememberScanOrigin() {
	var pt point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	scanOriginMu.Lock()
	scanOrigin = pt
	scanPrevFg = uintptr(windows.GetForegroundWindow())
	scanOriginMu.Unlock()
}

type scanWindow struct {
	main    webview2.WebView
	mainWnd uintptr
	view    webview2.WebView
	hwnd    uintptr
	oldProc uintptr
	prevFg  uintptr
	closing bool
}

var theScanWindow *scanWindow // pour la procédure de fenêtre

// newScanWindow crée la fenêtre de scan, cachée. À appeler avant main.Run() : la création
// de WebView2 fait tourner sa propre boucle de messages.
func newScanWindow(main webview2.WebView, mainWnd uintptr) *scanWindow {
	view := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath:  filepath.Join(appDataDir(), "WebView2"),
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  "Wak'Forge – scan",
			Width:  1, // créée minuscule puis cachée tout de suite
			Height: 1,
			IconId: 2,
		},
	})
	if view == nil {
		return nil
	}
	s := &scanWindow{main: main, mainWnd: mainWnd, view: view, hwnd: uintptr(view.Window())}
	theScanWindow = s
	procShowWindow.Call(s.hwnd, swHide)
	// fenêtre sans bordure, hors barre des tâches, toujours devant
	procSetWindowLongW.Call(s.hwnd, gwlStyle, wsPopup)
	procSetWindowLongW.Call(s.hwnd, gwlExStyle, wsExToolWindow|wsExTopmost)
	procSetWindowPos.Call(s.hwnd, hwndTopmost, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate|swpFrameChanged)
	// Alt+F4 ne doit pas détruire la fenêtre (la bibliothèque quitterait l'appli) : on la cache.
	s.oldProc, _, _ = procSetWindowLongPtrW.Call(s.hwnd, gwlpWndProc, windows.NewCallback(scanWndProc))

	_ = view.Bind("nativeScanAdd", func(id, qte int) {
		main.Dispatch(func() { main.Eval(fmt.Sprintf("window.wfScanAdd && window.wfScanAdd(%d, %d)", id, qte)) })
	})
	_ = view.Bind("nativeScanHave", func(id, qte int) {
		main.Dispatch(func() { main.Eval(fmt.Sprintf("window.wfScanHave && window.wfScanHave(%d, %d)", id, qte)) })
	})
	_ = view.Bind("nativeScanSetHave", func(id, qte int) {
		main.Dispatch(func() { main.Eval(fmt.Sprintf("window.wfScanSetHave && window.wfScanSetHave(%d, %d)", id, qte)) })
	})
	_ = view.Bind("nativeScanClose", func() {
		main.Dispatch(func() { s.close(true) })
	})
	_ = view.Bind("nativeScanItem", func(id int) {
		// « Voir la provenance » : là, on montre volontairement l'appli
		main.Dispatch(func() {
			s.close(false)
			if r, _, _ := procIsIconic.Call(mainWnd); r != 0 {
				procShowWindow.Call(mainWnd, swRestore)
			}
			forceForeground(mainWnd)
			main.Eval(fmt.Sprintf("window.wfScanItem && window.wfScanItem(%d)", id))
		})
	})
	view.Navigate(fmt.Sprintf("http://127.0.0.1:%d/scan.html", port))
	procSetForeground.Call(mainWnd) // la création a brièvement activé la fenêtre de scan
	return s
}

func scanWndProc(hwnd, msg, wp, lp uintptr) uintptr {
	s := theScanWindow
	switch msg {
	case wmClose:
		s.close(true)
		return 0
	case wmActivate:
		// clic ailleurs (retour dans le jeu) : la fenêtre se referme
		if wp&0xFFFF == 0 && !s.closing {
			if v, _, _ := procIsWindowVisible.Call(hwnd); v != 0 {
				procShowWindow.Call(hwnd, swHide)
			}
		}
	}
	r, _, _ := procCallWindowProcW.Call(s.oldProc, hwnd, msg, wp, lp)
	return r
}

// popupRect place la fenêtre à côté du curseur, dans la zone de travail de son écran.
func popupRect(pt point) rect {
	w, h, gap := int32(dpiScale(400)), int32(dpiScale(420)), int32(dpiScale(28))
	wa := rect{0, 0, int32(dpiScale(1280)), int32(dpiScale(720))}
	mon, _, _ := procMonitorFromPoint.Call(uintptr(uint32(pt.X))|uintptr(uint32(pt.Y))<<32, monitorDefaultToNear)
	if mon != 0 {
		mi := monitorInfo{}
		mi.CbSize = uint32(unsafe.Sizeof(mi))
		if r, _, _ := procGetMonitorInfoW.Call(mon, uintptr(unsafe.Pointer(&mi))); r != 0 {
			wa = mi.RcWork
		}
	}
	x := pt.X + gap
	if x+w > wa.R {
		x = pt.X - gap - w // pas la place à droite : à gauche du curseur
	}
	x = int32(clamp(int(x), int(wa.L), int(wa.R-w)))
	y := int32(clamp(int(pt.Y-h/2), int(wa.T), int(wa.B-h)))
	return rect{L: x, T: y, R: x + w, B: y + h}
}

// open affiche la fenêtre (état « lecture en cours ») à côté de la souris et lui donne le focus.
func (s *scanWindow) open() {
	scanOriginMu.Lock()
	pt, prev := scanOrigin, scanPrevFg
	scanOriginMu.Unlock()
	if prev == s.hwnd || prev == s.mainWnd {
		prev = 0
	}
	s.prevFg = prev
	s.view.Eval(`window.wfPop && window.wfPop({"state":"loading"})`)
	r := popupRect(pt)
	procSetWindowPos.Call(s.hwnd, hwndTopmost, uintptr(int(r.L)), uintptr(int(r.T)),
		uintptr(int(r.R-r.L)), uintptr(int(r.B-r.T)), swpShowWindow)
	forceForeground(s.hwnd)
}

// show transmet à la page de scan ce qu'elle doit afficher (objet, raretés, message…).
func (s *scanWindow) show(state json.RawMessage) {
	if v, _, _ := procIsWindowVisible.Call(s.hwnd); v == 0 {
		return // fermée pendant la lecture
	}
	s.view.Eval("window.wfPop && window.wfPop(" + string(state) + ")")
}

// close cache la fenêtre ; refocus rend d'abord le focus au jeu, pour qu'aucune autre fenêtre
// (Wak'Forge en particulier) ne passe devant entre-temps.
func (s *scanWindow) close(refocus bool) {
	s.closing = true
	if refocus && s.prevFg != 0 {
		procSetForeground.Call(s.prevFg)
	}
	procShowWindow.Call(s.hwnd, swHide)
	s.closing = false
}

// forceForeground donne le focus à la fenêtre. Windows peut le refuser à une appli en arrière-plan :
// on s'attache alors au fil de la fenêtre active (le jeu) le temps de prendre la main.
func forceForeground(hwnd uintptr) {
	procSetForeground.Call(hwnd)
	fg := windows.GetForegroundWindow()
	if uintptr(fg) == hwnd || fg == 0 {
		return
	}
	fgThread, _ := windows.GetWindowThreadProcessId(fg, nil)
	me := windows.GetCurrentThreadId()
	if fgThread == 0 || fgThread == me {
		return
	}
	procAttachThreadInput.Call(uintptr(me), uintptr(fgThread), 1)
	procBringWindowToTop.Call(hwnd)
	procSetForeground.Call(hwnd)
	procAttachThreadInput.Call(uintptr(me), uintptr(fgThread), 0)
}
