/* MMM-SceneSelector - GPU optimized
 * Single highlight element, compositor-only transitions
 */
Module.register("MMM-SceneSelector", {
    defaults: {
        timeout: 4500,
        scenes: [],
        title: "Szene wählen",
        inactivityTimeout: 120000
    },

    getStyles: function() {
        return ["MMM-SceneSelector.css"];
    },

    start: function() {
        this.selectedIndex = 0;
        this.currentIndex = 0;
        this.visible = false;
        this.timer = null;
        this.overlay = null;
        this.highlight = null;
        this.items = [];
        this._lastMove = 0;
        this._prevSelected = -1;
        this._prevCurrent = -1;
        this._inactivityTimer = null;
        this.sendSocketNotification("INIT", { scenes: this.config.scenes.length });
        var self = this;
        setTimeout(function() {
            if (!self.overlay) {
                Log.error("MMM-SceneSelector: overlay not built via notification, using fallback");
                self._buildOverlay();
            }
        }, 3000);
    },

    getDom: function() {
        var wrapper = document.createElement("div");
        wrapper.style.display = "none";
        return wrapper;
    },

    _buildOverlay: function() {
        if (this.overlay) return;
        try {
            this.overlay = document.createElement("div");
            this.overlay.id = "scene-selector-overlay";
            this.overlay.className = "scene-selector-overlay";

            var panel = document.createElement("div");
            panel.className = "scene-selector-panel";

            var title = document.createElement("div");
            title.className = "scene-selector-title";
            var titleIcon = document.createElement("i");
            titleIcon.className = "mdi mdi-view-grid";
            title.appendChild(titleIcon);
            var titleText = document.createElement("span");
            titleText.textContent = " " + this.config.title;
            title.appendChild(titleText);
            panel.appendChild(title);

            var list = document.createElement("div");
            list.className = "scene-selector-list";

            this.items = [];
            var self = this;
            this.config.scenes.forEach(function(scene, i) {
                var item = document.createElement("div");
                item.className = "scene-selector-item";
                item.dataset.index = i;
                if (i === 0) item.classList.add("current");

                var icon = document.createElement("i");
                icon.className = "mdi mdi-" + (scene.icon || "circle");
                item.appendChild(icon);

                var num = document.createElement("span");
                num.className = "scene-num";
                num.textContent = (i + 1);
                item.appendChild(num);

                var name = document.createElement("span");
                name.className = "scene-name";
                name.textContent = scene.display || scene.name;
                item.appendChild(name);

                list.appendChild(item);
                self.items.push(item);
            });

            // Single highlight element - GPU composited via transform
            this.highlight = document.createElement("div");
            this.highlight.className = "scene-selector-highlight";
            list.appendChild(this.highlight);

            panel.appendChild(list);
            this.overlay.appendChild(panel);
            document.body.appendChild(this.overlay);
        } catch (e) {
            Log.error("MMM-SceneSelector: _buildOverlay failed: " + e.message);
            this.overlay = null;
        }
    },

    _moveHighlight: function(index) {
        if (!this.highlight || !this.items[index]) return;
        var item = this.items[index];
        this.highlight.style.transform = "translate(" + item.offsetLeft + "px," + item.offsetTop + "px)";
        this.highlight.style.width = item.offsetWidth + "px";
        this.highlight.style.height = item.offsetHeight + "px";
    },

    showOverlay: function() {
        if (!this.overlay) return;
        if (!this.visible) {
            this.visible = true;
            this.selectedIndex = this.currentIndex;
            this._prevSelected = -1;
            this.overlay.classList.add("active");
            this._updateSelection();
            this.sendNotification("SCENES_PAUSE");
        }
    },

    hideOverlay: function() {
        if (!this.overlay) return;
        this.visible = false;
        this.overlay.classList.remove("active");
        // Clean up stale selected class so next show starts fresh
        if (this._prevSelected >= 0 && this._prevSelected < this.items.length) {
            this.items[this._prevSelected].classList.remove("selected");
        }
        this._prevSelected = -1;
    },

    _updateSelection: function() {
        // Move highlight via GPU transform (no repaint)
        this._moveHighlight(this.selectedIndex);

        // Toggle selected - only touch changed items (not all 20)
        if (this._prevSelected >= 0 && this._prevSelected < this.items.length) {
            this.items[this._prevSelected].classList.remove("selected");
        }
        this.items[this.selectedIndex].classList.add("selected");
        this._prevSelected = this.selectedIndex;

        // Toggle current marker - only touch changed items
        if (this._prevCurrent >= 0 && this._prevCurrent !== this.currentIndex && this._prevCurrent < this.items.length) {
            this.items[this._prevCurrent].classList.remove("current");
        }
        this.items[this.currentIndex].classList.add("current");
        this._prevCurrent = this.currentIndex;
    },

    moveSelection: function(direction) {
        // 16ms throttle (1 frame) - drop only if same frame
        var now = Date.now();
        if (now - this._lastMove < 16) return;
        this._lastMove = now;

        this.showOverlay();
        this.selectedIndex += direction;
        var total = this.config.scenes.length;
        if (this.selectedIndex < 0) this.selectedIndex = total - 1;
        if (this.selectedIndex >= total) this.selectedIndex = 0;
        this._updateSelection();
        this._resetTimer();
    },

    confirm: function() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.currentIndex = this.selectedIndex;
        this.hideOverlay();
        this.sendNotification("SCENES_PLAY", { scene: this.selectedIndex });
        this._updateSelection();
        // Keep scene paused after manual selection, resume after 2min inactivity
        var self = this;
        setTimeout(function() { self.sendNotification("SCENES_PAUSE"); }, 100);
        this._resetInactivityTimer();
    },

    _resetTimer: function() {
        var self = this;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(function() {
            self.confirm();
        }, this.config.timeout);
    },

    _resetInactivityTimer: function() {
        var self = this;
        if (this._inactivityTimer) clearTimeout(this._inactivityTimer);
        this._inactivityTimer = setTimeout(function() {
            self._inactivityTimer = null;
            self.sendNotification("SCENES_RESUME");
        }, this.config.inactivityTimeout);
    },

    cancel: function() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.selectedIndex = this.currentIndex;
        this.hideOverlay();
        this.sendNotification("SCENES_RESUME");
    },

    notificationReceived: function(notification, payload) {
        if (notification === "DOM_OBJECTS_CREATED" || notification === "MODULE_DOM_CREATED") {
            this._buildOverlay();
            return;
        }
        if (notification === "SELECTOR_NEXT") { this.moveSelection(1); return; }
        if (notification === "SELECTOR_PREV") { this.moveSelection(-1); return; }
        if (notification === "SELECTOR_CONFIRM") { if (this.visible) this.confirm(); return; }
        if (notification === "SELECTOR_CANCEL") { if (this.visible) this.cancel(); return; }
        if (notification === "SCENES_CHANGED") {
            if (payload && payload.index !== undefined) {
                this.currentIndex = payload.index;
                this._updateSelection();
            }
        }
    },

    socketNotificationReceived: function(notification, payload) {
        if (notification === "SELECTOR_NEXT") { this.moveSelection(1); return; }
        if (notification === "SELECTOR_PREV") { this.moveSelection(-1); return; }
        if (notification === "SELECTOR_CONFIRM") { if (this.visible) this.confirm(); return; }
        if (notification === "SELECTOR_CANCEL") { if (this.visible) this.cancel(); return; }
        if (notification === "SELECTOR_TIMEOUT") {
            this.config.timeout = payload;
            Log.info("MMM-SceneSelector: timeout set to " + payload + "ms");
            return;
        }

        // Bridge dial events from node_helper to MM-wide notifications
        if (notification === "DIAL_STATE") {
            this.sendNotification("DIAL_CONNECTED", payload);
            return;
        }
        if (notification === "DIAL_MODE") {
            this.sendNotification("DIAL_MODE", payload);
            return;
        }
        if (notification === "DIAL_ROTATE") {
            this.sendNotification("DIAL_ROTATE", payload);
            return;
        }
    }
});
