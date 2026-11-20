# Accessibility

> **Status: implemented. Manual screen-reader verification is pending.**
>
> The model below is implemented in `packages/controls/src/trackball.ts` and `interaction.ts`. Automated browser tests (Chromium) check the accessible name, role description, instructions and value text, the key bindings and step sizes, and that the focus ring appears for keyboard focus only.
>
> **No one has yet used it with VoiceOver, NVDA or another screen reader, in a browser or in a plug-in window,** and keyboard behaviour inside real DAWs is untested. Use the [manual check procedure](#manual-check-procedure) and record the results.

## Principles

- Every pointer action has a keyboard equivalent. No action requires a pointer gesture.
- Precise, predictable steps, with a 10× fine modifier. Native range sliders (in the playground) are an alternative for exact values.
- Keyboard edits produce the same balanced host gestures as pointer edits, coalesced so that a held key is one gesture.
- The control doesn't trap focus. Tab and Shift+Tab always move on.
- No motion the user didn't cause: no animation, no idle rendering.

## Keyboard and pointer model

The trackball is a focusable `div.lq-trackball` (`tabindex="0"`). Clicking it focuses it.

**Fine adjustment:** hold **Shift**, **Ctrl** or **Cmd (⌘)**. Every step becomes exactly 10× finer. On macOS, Ctrl+arrow keys are usually taken by the system, so use Shift or ⌘.

| Input | Effect | Coarse step | Fine step |
| --- | --- | --- | --- |
| ← / → | x − / + | 0.02 (1 % of `surface_x`) | 0.002 |
| ↑ / ↓ | y − / +. **↑ moves towards the top (PUNCH)**, because y = −1 is the top. | 0.02 | 0.002 |
| Page Up / Page Down | z + / − | 0.01 (1 % of `surface_z`) | 0.001 |
| Alt/Option + ↑ / ↓ | z + / − | 0.01 | 0.001 |
| Home or 0 | Reset to neutral `{ x: 0, y: 0, z: 0.5 }`. Ctrl/Cmd/Alt+0 are left to the browser (zoom reset). | | |
| Escape (during a drag) | Cancels the drag. The pre-drag pose is restored and sent, then the gesture ends. | | |
| Drag | x/y, relative. The marker follows the pointer 1:1, and pressing doesn't make it jump. | | 10× finer |
| Alt/Option + vertical drag | z (up increases) | | 10× finer |
| Wheel / trackpad scroll | z (up increases). A 100 px notch changes it by 0.025. | | 10× finer |
| Double-click | Reset to neutral | | |

- At the rim, x/y input slides along the disk edge.
- During a drag, other keyboard, wheel and double-click input is ignored, except Escape.
- Keys the control doesn't handle (Tab, shortcuts) keep their browser default.
- Because the default of ↑ is to *decrease* y (and the `surface_y` host value), the control doesn't behave like a vertical ARIA slider. This follows the screen convention of the pose contract.

**Gestures:** keys, wheel and double-click open one host gesture that ends 400 ms after the last input, on blur, or when a drag starts. Holding an arrow key therefore produces one host gesture, not one per auto-repeat. Input that changes nothing (pushing against a limit) opens no gesture.

## Screen readers

What the trackball exposes:

- `role="application"`, so screen readers pass the arrow keys through to the control.
- `aria-roledescription="trackball"`.
- An accessible name from the `label` option (default "Surface position"; the playground uses "Sound-space trackball").
- `aria-describedby`, pointing at two visually hidden elements:
  - the **value text**, from `formatValue` (default `"X 0.250, Y -0.400, Z 0.500"`). The playground prefixes the leading region and intensity, for example `"PUNCH, 40% intensity. X …"`.
  - the **instructions**, from the `description` option. The default is English, listing the arrow keys, Page Up/Down, Shift, Home/0 and Escape.

The value text is refreshed 350 ms after the last change, for user changes and for host/automation updates alike.

**User** changes are also announced through a visually hidden `aria-live="polite"` region (`aria-atomic="true"`), debounced by the same 350 ms, so a held key gives a single announcement. Host and automation updates are **not** announced.

The control has no `aria-valuenow` or `aria-valuetext`. It's a two-dimensional `application` widget, not a range widget. Assistive technology reads the value through the description and the live region.

**Playground:**

- Each axis also has a native `<input type="range">` with a visible `<label>`. The duplicated numeric readouts and the region labels around the ball are `aria-hidden`.
- The **Reset to neutral** button is a native `<button>`.

## Focus and contrast

- The trackball draws a high-contrast focus ring for **keyboard** focus (`:focus-visible`) only. Pointer focus shows no ring.
- In forced-colours mode (for example Windows contrast themes), the browser's own outline is kept. This is detected when the control is created.

## Motion

There are no animations or tweens. A frame is drawn only after a pose, focus, size or pixel-ratio change, so nothing runs while idle and there is nothing for `prefers-reduced-motion` to reduce. The playground's region bars have an 80 ms width transition, which is switched off under `prefers-reduced-motion: reduce`.

## Known gaps and open questions

- **Not verified with assistive technology** (VoiceOver, NVDA, Narrator, JAWS), nor in WKWebView or WebView2 inside a DAW.
- **DAW keyboard routing.** The JUCE example doesn't set `EDITOR_WANTS_KEYBOARD_FOCUS`, so JUCE's default (`FALSE`) applies. Some hosts may then keep arrow keys, Page Up/Down or the space bar for themselves. This is untested and a maintainer decision (see [releasing.md](releasing.md#open-maintainer-decisions)).
- The default instructions are English only. Pass `description` and `formatValue` for other languages.
- Forced-colours detection runs only at construction. Switching the mode while the control exists isn't tracked.

## Manual check procedure

Run each check in a browser **and** in the JUCE example's plug-in window (WKWebView on macOS, WebView2 on Windows). Screen-reader behaviour often differs between the two. Use `npm run dev`, or the built playground (`npm run build`, then `npm run preview -w @lowquo/surface-playground`), or a native build of the example. Record the exact announcements rather than "works".

### VoiceOver (macOS, Safari and the plug-in window)

1. Turn on VoiceOver (Cmd+F5).
2. Tab to the trackball. Expected: the name ("Sound-space trackball"), the role description ("trackball"), then the value text and instructions (possibly after a pause). Record what is actually said.
3. Press ← → ↑ ↓, Shift+arrow, Page Up/Down, Alt/Option+↑/↓, Home and 0. Confirm that the pose changes, and that after each burst **one** polite announcement of the new value follows.
4. Hold an arrow key for about 2 seconds. Expect one announcement after you release it, not a stream.
5. Drag the trackball with the mouse, then press Escape mid-drag. The pose should return to where the drag started.
6. Move through the page with VO+Right Arrow. Headings, the three sliders (label and value) and the reset button should each be reachable and named, and the region labels around the ball shouldn't be read.
7. Adjust each slider with the arrow keys. The new value should be announced, and the trackball should follow.
8. Activate **Reset to neutral** with VO+Space, and confirm that the controls return to neutral.
9. Turn on **Increase contrast** (System Settings → Accessibility → Display), and confirm that the keyboard focus ring is still visible.

### NVDA (Windows, Chrome or Edge, Firefox, and the plug-in window)

1. Start NVDA and open the playground.
2. Tab to the trackball. NVDA should switch to focus mode (the `application` role) and announce the name, role description and description. Record what it says.
3. Repeat steps 3–5 of the VoiceOver procedure. Confirm that browse mode doesn't consume the keys.
4. Press NVDA+Space to switch to browse mode. Using H (headings) and F (form fields), check that the sliders announce their label and value.
5. Adjust each slider, and activate the reset button with Space or Enter.
6. Turn on a Windows contrast theme, then reload. Confirm that the browser's focus outline appears on the trackball and that the controls stay visible.

### Also check

- Browser zoom at 200%: the layout stays usable, and the trackball still gets focus. Ctrl/Cmd+0 resets the zoom instead of the trackball.
- Keyboard only, with no mouse at all: every function in the page can be reached and used.
- In each DAW, whether arrow keys, Page Up/Down and Escape reach the plug-in. The [host checklist](testing.md#keyboard-focus-inside-the-plug-in-window) covers this.

### Results

| Date | OS + version | Screen reader + version | Browser / WebView | Commit | Result | Tester | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| _none yet_ | | | | | | | |
