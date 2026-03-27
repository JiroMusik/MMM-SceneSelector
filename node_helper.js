const NodeHelper = require("node_helper");
const mqtt = require("mqtt");
var WebSocket;
try { WebSocket = require("ws"); } catch(e) { WebSocket = global.WebSocket; }

require("dotenv").config({ path: __dirname + "/.env" });

const HA_WS_URL = process.env.HA_WS_URL || "ws://localhost:8123/api/websocket";
const HA_TOKEN = process.env.HA_TOKEN;
const DIAL_DEVICE_ID = process.env.DIAL_DEVICE_ID;
const WS_IDLE_TIMEOUT = parseInt(process.env.WS_IDLE_TIMEOUT, 10) || 4000;
const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost:1883";
const MQTT_TOPIC_PREFIX = (process.env.MQTT_TOPIC_PREFIX || "mm").replace(/\/+$/, "");

if (!HA_TOKEN) {
    console.error("MMM-SceneSelector: HA_TOKEN not set! Copy .env.example to .env and configure.");
}

module.exports = NodeHelper.create({
    start: function() {
        var self = this;
        this.haWs = null;
        this.haWsActive = false;
        this.haWsIdleTimer = null;
        this.haWsMsgId = 1;

        // Dial state
        this.dialConnected = false;
        // Dial mode: "scenes" (default), "brightness", "color_temp", "hue", "volume"
        this.dialMode = "scenes";

        // MQTT subscriber
        this.mqttClient = mqtt.connect(MQTT_URL);
        this.mqttClient.on("connect", function() {
            self.mqttClient.subscribe(MQTT_TOPIC_PREFIX + "/selector/#");
            self.mqttClient.subscribe(MQTT_TOPIC_PREFIX + "/dial/connected");
            self.mqttClient.subscribe(MQTT_TOPIC_PREFIX + "/dial/mode");
            self.mqttClient.subscribe(MQTT_TOPIC_PREFIX + "/selector/timeout");
            console.log("MMM-SceneSelector: MQTT connected (+ dial topics)");
        });
        this.mqttClient.on("error", function(err) {
            console.error("MMM-SceneSelector: MQTT error:", err.message);
        });
        this.mqttClient.on("message", function(topic, message) {
            // Dial connected state
            if (topic === MQTT_TOPIC_PREFIX + "/dial/connected") {
                try {
                    var d = JSON.parse(message.toString());
                    self.dialConnected = d.connected === true;
                    console.log("MMM-SceneSelector: Dial " + (self.dialConnected ? "CONNECTED" : "DISCONNECTED") + ", mode=" + self.dialMode);
                    self.sendSocketNotification("DIAL_STATE", {
                        connected: self.dialConnected,
                        mode: self.dialMode
                    });
                } catch(e) {}
                return;
            }

            // Dial mode change (from dashboard)
            if (topic === MQTT_TOPIC_PREFIX + "/dial/mode") {
                try {
                    var cfg = JSON.parse(message.toString());
                    if (cfg.mode) {
                        self.dialMode = cfg.mode;
                        console.log("MMM-SceneSelector: Dial mode changed to: " + self.dialMode);
                        self.sendSocketNotification("DIAL_MODE", {
                            mode: self.dialMode,
                            connected: self.dialConnected
                        });
                    }
                } catch(e) {}
                return;
            }

            // Selector timeout update
            if (topic === MQTT_TOPIC_PREFIX + "/selector/timeout") {
                try {
                    var timeout = parseInt(message.toString());
                    if (timeout >= 500 && timeout <= 10000) {
                        self.sendSocketNotification("SELECTOR_TIMEOUT", timeout);
                        console.log("MMM-SceneSelector: timeout updated to " + timeout + "ms");
                    }
                } catch(e) {}
                return;
            }

            var action = topic.split("/").pop();

            if (action === "activate") {
                self._activateHaWs();
                return;
            }

            if (action === "next" || action === "prev") {
                self._activateHaWs();
            }

            // If dial is connected and mode is not "scenes", handle rotation differently
            if (self.dialConnected && self.dialMode !== "scenes") {
                if (action === "next" || action === "prev") {
                    self.sendSocketNotification("DIAL_ROTATE", {
                        direction: action,
                        mode: self.dialMode
                    });
                    return;  // Don't forward as scene change
                }
            }

            self._handleAction(action);
        });

        // REST endpoints as fallback
        this.expressApp.get("/selector/next", function(req, res) {
            self._handleAction("next");
            self._activateHaWs();
            res.json({status: "ok", action: "next"});
        });
        this.expressApp.get("/selector/prev", function(req, res) {
            self._handleAction("prev");
            self._activateHaWs();
            res.json({status: "ok", action: "prev"});
        });
        this.expressApp.get("/selector/confirm", function(req, res) {
            self._handleAction("confirm");
            res.json({status: "ok", action: "confirm"});
        });
        this.expressApp.get("/selector/cancel", function(req, res) {
            self._handleAction("cancel");
            res.json({status: "ok", action: "cancel"});
        });
    },

    _handleAction: function(action) {
        if (action === "next") this.sendSocketNotification("SELECTOR_NEXT");
        else if (action === "prev") this.sendSocketNotification("SELECTOR_PREV");
        else if (action === "confirm") this.sendSocketNotification("SELECTOR_CONFIRM");
        else if (action === "cancel") this.sendSocketNotification("SELECTOR_CANCEL");
    },

    _activateHaWs: function() {
        if (this.haWsActive) {
            this._resetWsIdleTimer();
            return;
        }
        if (this.haWs) return;
        this._connectHaWs();
    },

    _connectHaWs: function() {
        var self = this;
        try {
            this.haWs = new WebSocket(HA_WS_URL);
        } catch(e) {
            console.error("MMM-SceneSelector: WS connect failed:", e.message);
            return;
        }

        this.haWs.on("message", function(data) {
            var msg;
            try { msg = JSON.parse(data.toString()); } catch(e) { return; }

            if (msg.type === "auth_required") {
                self.haWs.send(JSON.stringify({
                    type: "auth",
                    access_token: HA_TOKEN
                }));
            }
            else if (msg.type === "auth_ok") {
                self.haWsActive = true;
                self.haWsMsgId = 1;
                self.haWs.send(JSON.stringify({
                    id: self.haWsMsgId++,
                    type: "subscribe_events",
                    event_type: "hue_event"
                }));
                self._resetWsIdleTimer();
                console.log("MMM-SceneSelector: HA WS active");
            }
            else if (msg.type === "event" && msg.event) {
                var d = msg.event.data;
                if (d && d.device_id === DIAL_DEVICE_ID) {
                    if (d.subtype === "clock_wise") {
                        // If dial is connected and not in scene mode, route to DIAL_ROTATE
                        if (self.dialConnected && self.dialMode !== "scenes") {
                            self.sendSocketNotification("DIAL_ROTATE", {
                                direction: "next",
                                mode: self.dialMode
                            });
                        } else {
                            self._handleAction("next");
                        }
                        self._resetWsIdleTimer();
                    } else if (d.subtype === "counter_clock_wise") {
                        if (self.dialConnected && self.dialMode !== "scenes") {
                            self.sendSocketNotification("DIAL_ROTATE", {
                                direction: "prev",
                                mode: self.dialMode
                            });
                        } else {
                            self._handleAction("prev");
                        }
                        self._resetWsIdleTimer();
                    }
                }
            }
        });

        this.haWs.on("error", function(err) {
            console.error("MMM-SceneSelector: HA WS error:", err.message);
        });

        this.haWs.on("close", function() {
            self.haWsActive = false;
            self.haWs = null;
        });
    },

    _resetWsIdleTimer: function() {
        var self = this;
        if (this.haWsIdleTimer) clearTimeout(this.haWsIdleTimer);
        this.haWsIdleTimer = setTimeout(function() {
            self._disconnectHaWs();
        }, WS_IDLE_TIMEOUT);
    },

    _disconnectHaWs: function() {
        if (this.haWsIdleTimer) clearTimeout(this.haWsIdleTimer);
        this.haWsIdleTimer = null;
        if (this.haWs) {
            try { this.haWs.close(); } catch(e) {}
            this.haWs = null;
        }
        this.haWsActive = false;
        console.log("MMM-SceneSelector: HA WS closed (idle)");
    },

    socketNotificationReceived: function(notification, payload) {
        if (notification === "INIT") {
            console.log("MMM-SceneSelector: ready, scenes=" + (payload && payload.scenes));
        }
    },

    stop: function() {
        this._disconnectHaWs();
        if (this.mqttClient) this.mqttClient.end();
    }
});