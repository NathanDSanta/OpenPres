// Settings panel ("property inspector") of every OpenPres key. Plain JavaScript and the
// Stream Deck's own messages, so it works in Elgato's app and in OpenDeck, offline too.
(() => {
	"use strict";

	// ---------------- what each key can be set to ----------------

	const LABEL = (automatic) => ({
		type: "text",
		key: "label",
		label: "Label",
		placeholder: automatic.charAt(0).toUpperCase() + automatic.slice(1),
		note: "Leave empty for the automatic text.",
	});
	const TARGETS = [
		["auto", "Slides or Bible, like the arrow keys"],
		["slides", "Slides only"],
		["announcements", "Announcements only"],
		["bible", "Bible passage only"],
	];

	const SPECS = {
		next: {
			fields: [{ type: "select", key: "target", label: "Moves", choices: TARGETS }, LABEL("Next")],
			about: "Next slide. Like the arrow keys in OpenPres, it moves the Bible passage instead when that was shown last, and the announcements too.",
		},
		previous: {
			fields: [{ type: "select", key: "target", label: "Moves", choices: TARGETS }, LABEL("Previous")],
			about: "Previous slide. Like the arrow keys in OpenPres, it moves the Bible passage instead when that was shown last, and the announcements too.",
		},
		slide: {
			fields: [
				{ type: "number", key: "number", label: "Slide", min: 1, placeholder: "1" },
				{ type: "select", key: "layer", label: "Of", choices: [["slides", "The slides on screen"], ["announcements", "The announcements"]] },
				LABEL("Slide 1"),
			],
			about: "Jumps to a slide of what is on screen, e.g. back to the chorus. Lit while that slide shows.",
		},
		clear: {
			fields: [
				{
					type: "select",
					key: "layer",
					label: "Clears",
					choices: [
						["all", "All (every visual layer)"],
						["everything", "Everything (and the audio)"],
						["slides", "Slides"],
						["bible", "Bible"],
						["announcements", "Announcements"],
						["media", "Media (pictures and videos)"],
						["video_input", "Camera (video input)"],
						["props", "Props"],
						["complements", "Complements"],
						["audio", "Audio"],
					],
				},
				LABEL("automatic"),
			],
			about: "Lit while there is something to clear; the second line says what.",
		},
		bible: {
			fields: [
				{ type: "bible", key: "query", label: "Passage", placeholder: "e.g. John 3:16-18" },
				{ type: "select", key: "mode", label: "Press", choices: [["show", "Shows it"], ["toggle", "Shows it, or clears it when on screen"]] },
				LABEL("the passage"),
			],
			about: "Shows a passage, written as in OpenPres's Bible search. Lit while it is on screen.",
		},
		prop: {
			fields: [
				{ type: "select", key: "layer", label: "Layer", choices: [["props", "Props"], ["complements", "Complements"]] },
				{ type: "pick", list: "props", label: "Design" },
				{ type: "select", key: "mode", label: "Press", choices: [["toggle", "Shows or hides it"], ["show", "Shows it"], ["hide", "Hides it"]] },
				LABEL("the design's name"),
			],
			about: "Puts a prop or complement on screen, or takes it off. Lit while it is on.",
		},
		camera: {
			fields: [
				{ type: "pick", list: "cameras", label: "Camera" },
				{ type: "select", key: "mode", label: "Press", choices: [["toggle", "Shows it, or clears it when on"], ["show", "Shows it"]] },
				LABEL("the camera's name"),
			],
			about: "Shows a camera on the video input layer. Lit while it is on screen.",
		},
		media: {
			fields: [
				{ type: "select", key: "mode", label: "Press", choices: [["toggle", "Play / pause"], ["next", "Next item"], ["previous", "Previous item"], ["folder", "Plays a media folder"]] },
				{ type: "select", key: "slot", label: "Player", choices: [["visual", "Pictures and videos"], ["audio", "Audio"]], showIf: (s) => s.mode !== "folder" },
				{ type: "pick", list: "folders", label: "Folder", showIf: (s) => s.mode === "folder" },
				LABEL("automatic"),
			],
			about: "Controls the media and audio players. A folder key starts the folder, then pauses and resumes it.",
		},
		mute: {
			fields: [
				{ type: "pick", list: "buses", label: "Bus" },
				{ type: "select", key: "mode", label: "Press", choices: [["toggle", "Mutes or unmutes"], ["mute", "Mutes"], ["unmute", "Unmutes"]] },
				LABEL("the bus name"),
			],
			about: "Mutes an audio bus of OpenPres's mixer. Red while muted.",
		},
		timer: {
			fields: [
				{ type: "pick", list: "timers", label: "Timer" },
				{ type: "select", key: "mode", label: "Press", choices: [["toggle", "Starts or pauses"], ["start", "Starts"], ["pause", "Pauses"], ["reset", "Resets"]] },
				LABEL("the timer's name"),
			],
			about: "Shows the timer's time. Lit while running, red when over time.",
		},
		stream: {
			fields: [
				{ type: "select", key: "mode", label: "Press", choices: [["toggle", "Goes live, or stops"], ["start", "Goes live"], ["stop", "Stops"]] },
				{ type: "check", key: "hold", label: "Stopping", text: "Hold the key for a second", default: true, showIf: (s) => s.mode !== "start" },
				LABEL("automatic"),
			],
			about: "Starts the stream (and recording) as set up in OpenPres's Live page, and shows how long it has been live.",
		},
	};

	// ---------------- state ----------------

	let socket = null;
	let context = "";
	let actionUUID = "";
	let spec = null;
	let settings = {};
	let global = {};
	let state = null; // { status, options } from the plugin
	let connectionOpened = false;
	const fields = [];

	const $ = (id) => document.getElementById(id);

	function el(tag, className, text) {
		const e = document.createElement(tag);
		if (className) e.className = className;
		if (text !== undefined) e.textContent = text;
		return e;
	}

	function send(event, extra) {
		if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(Object.assign({ event, context }, extra)));
	}

	function saveSettings() {
		send("setSettings", { payload: settings });
		refreshVisibility();
	}

	function toPlugin(payload) {
		send("sendToPlugin", { action: actionUUID, payload });
	}

	function debounce(fn, ms) {
		let timer = 0;
		return (...args) => {
			clearTimeout(timer);
			timer = setTimeout(() => fn(...args), ms);
		};
	}

	// ---------------- fields ----------------

	function row(labelText, control, id) {
		const r = el("div", "row");
		const label = el("label", "", labelText);
		if (id) label.htmlFor = id;
		const c = el("div", "control");
		c.append(control);
		r.append(label, c);
		return r;
	}

	function option(value, text, disabled) {
		const o = el("option", "", text);
		o.value = value;
		if (disabled) o.disabled = true;
		return o;
	}

	function makeField(f, i) {
		const id = `f${i}`;
		const box = el("div");
		let update = () => {};
		if (f.type === "select") {
			const select = el("select");
			select.id = id;
			for (const [value, text] of f.choices) select.append(option(value, text));
			select.onchange = () => {
				settings[f.key] = select.value;
				saveSettings();
			};
			update = () => {
				const value = settings[f.key];
				select.value = f.choices.some((c) => c[0] === value) ? value : f.choices[0][0];
			};
			box.append(row(f.label, select, id));
		} else if (f.type === "text" || f.type === "number" || f.type === "bible") {
			const input = el("input");
			input.id = id;
			input.type = f.type === "number" ? "number" : "text";
			if (f.min !== undefined) input.min = String(f.min);
			input.placeholder = f.placeholder || "";
			input.spellcheck = false;
			const note = el("div", "note", f.note || "");
			const check = f.type === "bible" ? debounce((q) => toPlugin({ type: "parse", query: q }), 350) : null;
			const store = debounce(() => {
				settings[f.key] = f.type === "number" ? (input.value === "" ? undefined : Number(input.value)) : input.value;
				saveSettings();
			}, 400);
			input.oninput = () => {
				store();
				if (check) {
					note.className = "note";
					note.textContent = input.value.trim() ? "Checking…" : "";
					check(input.value.trim());
				}
			};
			update = () => {
				if (document.activeElement === input) return;
				const value = settings[f.key];
				input.value = value === undefined || value === null ? "" : String(value);
				if (check && input.value.trim()) check(input.value.trim());
			};
			box.append(row(f.label, input, id));
			if (f.note || check) box.append(note);
			if (check) {
				box.parsed = (msg) => {
					if (msg.query !== input.value.trim()) return;
					if (msg.label) {
						note.className = "note ok";
						note.textContent = `✓ ${msg.label}`;
					} else {
						note.className = msg.error ? "note" : "note bad";
						note.textContent = msg.error ? `Can't check it now: ${msg.error}` : "✗ Not a Bible reference OpenPres knows";
					}
				};
			}
		} else if (f.type === "check") {
			const input = el("input");
			input.type = "checkbox";
			input.id = id;
			const label = el("label", "check");
			label.append(input, document.createTextNode(f.text));
			input.onchange = () => {
				settings[f.key] = input.checked;
				saveSettings();
			};
			update = () => {
				const value = settings[f.key];
				input.checked = typeof value === "boolean" ? value : !!f.default;
			};
			const r = el("div", "row");
			r.append(el("span", "label", f.label));
			const c = el("div", "control");
			c.append(label);
			r.append(c);
			box.append(r);
		} else if (f.type === "pick") {
			const select = el("select");
			select.id = id;
			const note = el("div", "note");
			select.onchange = () => {
				pickers[f.list].set(select.value);
				saveSettings();
			};
			update = () => {
				const p = pickers[f.list];
				const list = p.items();
				const current = p.current();
				select.replaceChildren();
				if (!current) select.append(option("", state ? (list.length ? "Choose…" : p.empty) : "Connecting to OpenPres…", true));
				let groups = new Map();
				let found = false;
				for (const item of list) {
					let parent = select;
					if (item.group) {
						if (!groups.has(item.group)) {
							const g = el("optgroup");
							g.label = item.group;
							select.append(g);
							groups.set(item.group, g);
						}
						parent = groups.get(item.group);
					}
					parent.append(option(item.value, item.text));
					if (item.value === current) found = true;
				}
				if (current && !found) select.append(option(current, `${p.savedName() || "Saved choice"} (${state ? "not found" : "not connected"})`));
				select.value = current || "";
				note.textContent = current && !found && state ? p.missing : "";
			};
			box.append(row(f.label, select, id), note);
		}
		fields.push({ f, box, update });
		return box;
	}

	/** The lists that come from OpenPres, and which settings a choice sets. */
	const pickers = {
		props: {
			empty: "No props yet (Themes → Props)",
			missing: "This design was deleted or renamed in OpenPres.",
			items: () =>
				((state && state.options.props) || []).flatMap((t) => t.designs.map((d) => ({ value: `${t.id}|${d.id}`, text: d.name, group: t.name }))),
			current: () => (settings.theme_id && settings.design_id ? `${settings.theme_id}|${settings.design_id}` : ""),
			savedName: () => settings.name,
			set(value) {
				const [theme_id, design_id] = value.split("|");
				const theme = ((state && state.options.props) || []).find((t) => t.id === theme_id);
				const design = theme && theme.designs.find((d) => d.id === design_id);
				Object.assign(settings, { theme_id, design_id, name: design ? design.name : "" });
			},
		},
		cameras: {
			empty: "No cameras found",
			missing: "This camera is not connected now.",
			items: () => ((state && state.options.cameras) || []).map((c) => ({ value: c.id, text: c.connected ? c.name : `${c.name} (not connected)` })),
			current: () => settings.device_id || "",
			savedName: () => settings.name,
			set(value) {
				const cam = ((state && state.options.cameras) || []).find((c) => c.id === value);
				Object.assign(settings, { device_id: value, name: cam ? cam.name : "" });
			},
		},
		folders: {
			empty: "No media folders yet",
			missing: "This folder was deleted in OpenPres.",
			items: () =>
				((state && state.options.folders) || []).map((f) => ({
					value: f.id,
					text: f.name,
					group: f.kind === "audio" ? "Audio" : f.kind === "image" ? "Pictures" : "Videos",
				})),
			current: () => settings.folder_id || "",
			savedName: () => settings.name,
			set(value) {
				const folder = ((state && state.options.folders) || []).find((f) => f.id === value);
				Object.assign(settings, { folder_id: value, name: folder ? folder.name : "" });
			},
		},
		buses: {
			empty: "No audio buses",
			missing: "This bus does not exist in OpenPres.",
			items: () => ((state && state.options.buses) || []).map((b) => ({ value: String(b.n), text: `${b.n}. ${b.name}` })),
			current: () => (settings.bus ? String(settings.bus) : state && state.options.buses.length ? "1" : ""),
			savedName: () => (settings.bus ? `Bus ${settings.bus}` : ""),
			set(value) {
				settings.bus = Number(value);
			},
		},
		timers: {
			empty: "No timers yet (Timers page)",
			missing: "This timer was deleted in OpenPres.",
			items: () => ((state && state.options.timers) || []).map((t) => ({ value: t.id, text: t.name })),
			current: () => settings.timer_id || "",
			savedName: () => settings.name,
			set(value) {
				const timer = ((state && state.options.timers) || []).find((t) => t.id === value);
				Object.assign(settings, { timer_id: value, name: timer ? timer.name : "" });
			},
		},
	};

	function refreshVisibility() {
		for (const { f, box } of fields) box.classList.toggle("hidden", !!f.showIf && !f.showIf(settings));
	}

	function refreshFields() {
		for (const field of fields) field.update();
		refreshVisibility();
	}

	function build() {
		const main = $("fields");
		main.replaceChildren();
		fields.length = 0;
		if (!spec) {
			main.append(el("p", "about", "This key is from a newer version of the plugin."));
			return;
		}
		spec.fields.forEach((f, i) => main.append(makeField(f, i)));
		main.append(el("p", "about", spec.about));
		refreshFields();
	}

	// ---------------- connection (shared by all keys) ----------------

	const saveGlobal = debounce(() => send("setGlobalSettings", { payload: global }), 500);

	function bindConnection() {
		for (const key of ["host", "port", "password"]) {
			const input = $(key);
			input.oninput = () => {
				global[key] = input.value.trim() === "" ? "" : key === "password" ? input.value : input.value.trim();
				saveGlobal();
			};
		}
		$("retry").onclick = () => toPlugin({ type: "retry" });
	}

	function showGlobal() {
		for (const key of ["host", "port", "password"]) {
			const input = $(key);
			if (document.activeElement !== input) input.value = global[key] === undefined || global[key] === null ? "" : String(global[key]);
		}
	}

	function showStatus() {
		const s = state && state.status;
		const dot = $("dot");
		const text = $("status");
		const detail = $("status-detail");
		if (!s) {
			dot.className = "dot";
			text.textContent = "Starting…";
			detail.textContent = "";
			return;
		}
		dot.className = s.connected ? "dot ok" : "dot bad";
		text.replaceChildren();
		if (s.connected) {
			text.append(el("strong", "", "Connected"), document.createTextNode(` to OpenPres ${s.version || ""} at ${s.address}`));
			detail.textContent = "";
			detail.className = "note";
		} else {
			text.append(el("strong", "", "Not connected"), document.createTextNode(` · ${s.address}`));
			detail.textContent = s.error || "";
			detail.className = "note bad";
			// Show the connection settings once when there is a problem.
			if (!connectionOpened && s.error && !/connecting/.test(s.error)) {
				connectionOpened = true;
				$("connection").open = true;
			}
		}
	}

	/** A newer plugin is out (each OpenPres release has one): a note on top with Download. */
	function showUpdate() {
		const u = state && state.update;
		const box = $("update");
		box.replaceChildren();
		box.classList.toggle("hidden", !(u && u.latest));
		if (!u || !u.latest) return;
		const button = el("button", "", "Download");
		button.type = "button";
		button.onclick = () => toPlugin({ type: "update" });
		box.append(el("span", "", `OpenPres plugin ${u.latest} is available (this is ${u.current}).`), button);
	}

	// ---------------- messages from Stream Deck and the plugin ----------------

	function onMessage(message) {
		const payload = message.payload || {};
		switch (message.event) {
			case "didReceiveSettings":
				settings = (payload.settings && typeof payload.settings === "object" && payload.settings) || {};
				refreshFields();
				break;
			case "didReceiveGlobalSettings":
				global = (payload.settings && typeof payload.settings === "object" && payload.settings) || {};
				showGlobal();
				break;
			case "sendToPropertyInspector":
				if (payload.type === "state") {
					state = { status: payload.status, update: payload.update || null, options: Object.assign({ props: [], timers: [], cameras: [], folders: [], buses: [] }, payload.options) };
					showStatus();
					showUpdate();
					for (const field of fields) if (field.f.type === "pick") field.update();
				} else if (payload.type === "parsed") {
					for (const field of fields) if (field.box.parsed) field.box.parsed(payload);
				}
				break;
		}
	}

	window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, info, actionInfo) => {
		context = uuid;
		let parsed = {};
		try {
			parsed = typeof actionInfo === "string" ? JSON.parse(actionInfo) : actionInfo || {};
		} catch (e) {
			parsed = {};
		}
		actionUUID = parsed.action || "";
		spec = SPECS[actionUUID.split(".").pop()] || null;
		settings = (parsed.payload && parsed.payload.settings) || {};
		build();
		bindConnection();
		showStatus();

		socket = new WebSocket(`ws://127.0.0.1:${port}`);
		socket.onopen = () => {
			socket.send(JSON.stringify({ event: registerEvent, uuid }));
			send("getGlobalSettings");
			toPlugin({ type: "hello" });
			// The plugin may not have known about this panel yet: ask again.
			setTimeout(() => {
				if (!state) toPlugin({ type: "hello" });
			}, 1500);
		};
		socket.onmessage = (e) => {
			try {
				onMessage(JSON.parse(e.data));
			} catch (err) {
				console.error(err);
			}
		};
	};
})();
