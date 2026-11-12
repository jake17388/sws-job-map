# iPhone layout investigation — 2026-11-12

## Reported behavior

The installed app on iOS 27.0.1 showed system blur across its top header
and a separate light band at the bottom. The user confirmed release
2026.11.12.3 was loaded. Earlier status-bar meta changes and a small fixed
status strip did not visibly resolve the issue on that phone.

## Findings and implementation

- The old body combined fixed positioning and all four insets with a
  `100dvh` height. The app added a percentage height. These constraints can
  disagree when iOS's layout and visual viewports differ. This is a possible
  explanation for the bottom gap, pending measurements on the affected phone.
- The old header was a normal flex child with a gradient background. WebKit
  samples fixed/sticky containers at viewport edges. A solid real header
  gives it an opaque color candidate without depending on a decorative strip.
- The app now owns one fixed frame with four insets and no viewport-unit
  height. Body is the non-scrolling document background. The sticky header
  has a solid navy background and owns its top safe padding.
- Lists scroll inside that frame. Bottom safe space is an end-of-list
  pseudo-element rather than padding that imposes a minimum list height.
- Settings retains its header outside its scrolling body. Mobile sheets use
  common safe-area variables and stay above a detected software keyboard.
- The visual viewport affects the keyboard inset only while an editable
  field is focused and substantial occlusion is present. It does not set
  the normal app height. Pinch zoom and status-bar-sized viewport differences
  must not create a bottom gap.
- Landscape phones use the mobile UI, with Filters and Vehicles in one row.
  Mobile input text is 16px to avoid focus-triggered Safari zoom.

## Verification and limits

`npm run check` passes 127 checks, including normal viewport difference,
keyboard opening/closing, viewport panning, and pinch-zoom handling.

Browser layout inspection used production HTML/CSS with synthetic job rows
and simulated safe-area insets. Surfaces were 440×956, 402×874, 375×667,
and 844×390. App frames filled the available iframe, the landscape list
stayed within its frame, and Settings retained its header while content
scrolled. These are Chromium geometry checks, not an iOS simulator or native
Home Screen test. They cannot verify the system blur or areas outside the
webview.

If either band remains, use Settings → Display troubleshooting → Copy
display report. It records release, standalone mode, screen/window and
visual viewport dimensions, safe insets, keyboard inset, and app/header
rectangles and styles. It contains no auth token, PIN, account name, job
content, or backend credentials. Compare screen, window, and app bottom
before attempting another device-specific adjustment.

## References

- WebKit edge sampling implementation:
  https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/LocalFrameView.cpp
- Native keyboard inset issue:
  https://bugs.webkit.org/show_bug.cgi?id=292603
- Standalone status-bar geometry reports:
  https://bugs.webkit.org/show_bug.cgi?id=317153

These describe engine behavior and reported bugs; they do not establish
which native bug, if any, affects this phone.
