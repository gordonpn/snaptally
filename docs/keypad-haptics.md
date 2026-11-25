# Keypad haptic feedback feasibility

Evidence checked on November 24, 2026. This is a platform investigation, not an
implemented feature or a physical-device test.

## Findings

SnapTally renders its amount keypad as HTML buttons in `src/pages/index.astro`.
It runs as a web application, including when installed as a PWA; it has no native
iOS bridge. The existing browser profiles cover Android Chromium and iOS WebKit.

| Platform | Available mechanism | Meaning for SnapTally |
| --- | --- | --- |
| Android Chromium with vibration hardware | `navigator.vibrate()` | Short best-effort vibration is possible after user interaction; device/browser settings can suppress it. |
| Safari on iPhone, including its installed web app | No general Vibration API | Arbitrary amount-keypad buttons cannot request portable vibration through this API. |
| Firefox desktop / Android | Removed on desktop; Android compatibility data describes a no-op implementation | Do not infer tactile support from the method existing or returning true. |
| Desktop browsers / physical keyboards | Browser API concerns the hosting device, not individual key hardware | A key event does not provide control over a keyboard's haptic actuator. |

The [Vibration API specification](https://w3c.github.io/vibration/) requires a
visible document and prior user activation, permits the browser to decline, and
does not provide intensity control or confirmation that a vibration was felt.
The [MDN compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json)
records Android Chromium support, Safari's lack of support, and Firefox's limits.
The [MDN method reference](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate)
also notes that hardware and system settings affect the result.

WebKit documents haptics for a real native checkbox switch in
[Safari 18](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/).
That is a switch interaction, not a general-purpose keypad haptics API. Hidden
switches or synthetic toggles are not a suitable replacement for semantically
correct amount buttons. A JavaScript library cannot supply a missing native API.

## Recommendation

Make no application change for now. Consistent keypad haptics on the current iOS
and Android targets are not available through a shared web API. Keep existing
visual pressed-state and amount feedback; do not add a native wrapper or a
haptics dependency solely for this interaction.

If Android-only feedback becomes an explicit priority, use the native API as
optional, default-off progressive enhancement with a persisted user toggle.
Request one short pulse only for an accepted keypad action, never wait for it,
and preserve identical amount entry when unsupported, disabled, or declined.
Physical key activation could use the same accepted action on supported devices,
but would vibrate the device rather than the physical key. Do not add a separate
global keyboard listener or fire on text entry, navigation, or rejected actions.

Before adopting that optional behavior, verify on physical Android hardware that
rapid taps, silent/DND settings, disabled preference, offline operation and normal
entry still work. Verify on an iPhone that unsupported feedback adds no error or
delay. Browser emulation can test dispatch and fallback, but cannot establish
tactile quality or actual hardware response. Revisit the no-change recommendation
if Safari exposes a general supported haptics API or native deployment becomes a
separate product requirement.
