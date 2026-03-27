# MMM-SceneSelector

A [MagicMirror](https://magicmirror.builders/) module that provides a GPU-optimized scene selection overlay. Navigate between scenes using a Philips Hue Dial, MQTT messages, or REST endpoints.

![MagicMirror Module](https://img.shields.io/badge/MagicMirror-Module-blue)

## Features

- Full-screen overlay with smooth, compositor-only CSS transitions (no repaints)
- Philips Hue Dial support via Home Assistant WebSocket API
- MQTT control for integration with any automation system
- REST API fallback endpoints
- Multi-mode dial support (scenes, brightness, color temperature, hue, volume)
- Auto-confirm after configurable timeout
- Auto-resume scene rotation after inactivity

## Prerequisites

- [MagicMirror](https://magicmirror.builders/) >= 2.0
- An MQTT broker (e.g. [Mosquitto](https://mosquitto.org/))
- [Home Assistant](https://www.home-assistant.io/) (optional, for Hue Dial support)
- A Philips Hue Dial (optional)

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/JiroMusik/MMM-SceneSelector.git
cd MMM-SceneSelector
npm install
```

## Configuration

### 1. Environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Description | Default |
|---|---|---|
| `HA_WS_URL` | Home Assistant WebSocket URL | `ws://localhost:8123/api/websocket` |
| `HA_TOKEN` | Home Assistant Long-Lived Access Token | *(required)* |
| `DIAL_DEVICE_ID` | Hue Dial device ID (find in HA &rarr; Settings &rarr; Devices) | *(required for dial)* |
| `WS_IDLE_TIMEOUT` | Close HA WebSocket after this many ms of inactivity | `4000` |
| `MQTT_URL` | MQTT broker URL | `mqtt://localhost:1883` |
| `MQTT_TOPIC_PREFIX` | Prefix for all MQTT topics | `mm` |

To create a Home Assistant Long-Lived Access Token:
1. Go to your HA profile page (`/profile`)
2. Scroll to "Long-Lived Access Tokens"
3. Click "Create Token" and copy the value into your `.env`

### 2. MagicMirror config.js

Add the module to your `config/config.js`:

```javascript
{
    module: "MMM-SceneSelector",
    config: {
        timeout: 4500,            // Auto-confirm after ms (default: 4500)
        inactivityTimeout: 120000, // Resume scene rotation after ms (default: 120000)
        title: "Szene wählen",    // Overlay title text
        scenes: [
            { name: "relax",    display: "Relax",        icon: "sofa" },
            { name: "focus",    display: "Focus",        icon: "desk-lamp" },
            { name: "movie",    display: "Movie Night",  icon: "movie-open" },
            { name: "sleep",    display: "Sleep",        icon: "weather-night" },
            { name: "party",    display: "Party",        icon: "party-popper" },
            { name: "cooking",  display: "Cooking",      icon: "pot-steam" }
        ]
    }
}
```

#### Scene options

| Property | Description |
|---|---|
| `name` | Internal scene identifier |
| `display` | Label shown in the overlay (falls back to `name`) |
| `icon` | [Material Design Icon](https://pictogrammers.com/library/mdi/) name (without `mdi-` prefix) |

#### Module config options

| Option | Type | Default | Description |
|---|---|---|---|
| `timeout` | `number` | `4500` | Auto-confirm selection after this many ms |
| `inactivityTimeout` | `number` | `120000` | Resume automatic scene rotation after this many ms of inactivity |
| `title` | `string` | `"Szene wählen"` | Title text displayed at the top of the overlay |
| `scenes` | `array` | `[]` | List of scene objects (see above) |

## Control

### MQTT

Publish to these topics (default prefix `mm`):

| Topic | Payload | Description |
|---|---|---|
| `mm/selector/next` | *(any)* | Move selection down |
| `mm/selector/prev` | *(any)* | Move selection up |
| `mm/selector/confirm` | *(any)* | Confirm current selection |
| `mm/selector/cancel` | *(any)* | Cancel and close overlay |
| `mm/selector/activate` | *(any)* | Wake up the HA WebSocket connection |
| `mm/selector/timeout` | `3000` | Update auto-confirm timeout (500-10000 ms) |
| `mm/dial/connected` | `{"connected": true}` | Report dial connection state |
| `mm/dial/mode` | `{"mode": "brightness"}` | Switch dial mode (`scenes`, `brightness`, `color_temp`, `hue`, `volume`) |

### REST API

The module exposes endpoints on the MagicMirror Express server:

| Endpoint | Description |
|---|---|
| `GET /selector/next` | Move selection down |
| `GET /selector/prev` | Move selection up |
| `GET /selector/confirm` | Confirm selection |
| `GET /selector/cancel` | Cancel overlay |

### Hue Dial

When configured with a `DIAL_DEVICE_ID`, the module listens for `hue_event` events via the Home Assistant WebSocket API. The dial rotation maps to next/prev scene selection. The WebSocket connection is opened on demand and closed after `WS_IDLE_TIMEOUT` ms of inactivity.

### Notifications

The module sends and receives MagicMirror notifications for integration with other modules:

| Notification | Direction | Payload | Description |
|---|---|---|---|
| `SCENES_PLAY` | Sent | `{ scene: index }` | Scene was selected |
| `SCENES_PAUSE` | Sent | - | Pause automatic scene rotation |
| `SCENES_RESUME` | Sent | - | Resume automatic scene rotation |
| `SCENES_CHANGED` | Received | `{ index: number }` | External scene change |
| `SELECTOR_NEXT` | Received | - | Move selection down |
| `SELECTOR_PREV` | Received | - | Move selection up |
| `SELECTOR_CONFIRM` | Received | - | Confirm selection |
| `SELECTOR_CANCEL` | Received | - | Cancel overlay |
| `DIAL_CONNECTED` | Sent | `{ connected, mode }` | Dial connection state changed |
| `DIAL_MODE` | Sent | `{ mode, connected }` | Dial mode changed |
| `DIAL_ROTATE` | Sent | `{ direction, mode }` | Dial rotated in non-scene mode |

## License

MIT
