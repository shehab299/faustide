// import { Faust } from "faust2webaudio";
// TODO
// documentation hover + Ctrl+D
// localStorage params, dsps
// Faust2MD
// File Name
// Real-Time compile
// Error alert
import * as monaco from "monaco-editor";
import webmidi, { Input } from "webmidi";
import { FaustScriptProcessorNode, FaustAudioWorkletNode } from "faust2webaudio";
import * as QRCode from "qrcode";
import * as WaveSurfer from "wavesurfer.js";
import "bootstrap/js/dist/tab";
import "bootstrap/js/dist/tooltip";
import "bootstrap/js/dist/modal";
import "@fortawesome/fontawesome-free/css/all.css";
import "bootstrap/scss/bootstrap.scss";
import "./index.scss";
import { Key2Midi } from "./key2midi";
declare global {
    interface Window {
        AudioContext: typeof AudioContext;
        webkitAudioContext: typeof AudioContext;
        AudioWorklet?: typeof AudioWorklet;
        faustEnv: FaustEditorEnv;
    }
}
type FaustEditorEnv = {
    audioEnv: FaustEditorAudioEnv;
    midiEnv: FaustEditorMIDIEnv;
    uiEnv: FaustEditorUIEnv;
    compileOptions: FaustEditorCompileOptions;
    editor?: monaco.editor.IStandaloneCodeEditor;
    jQuery: JQueryStatic;
};
type FaustEditorAudioEnv = {
    audioCtx?: AudioContext,
    splitterInput?: ChannelSplitterNode;
    analyserInputI: number;
    analyserInput?: AnalyserNode,
    splitterOutput?: ChannelSplitterNode;
    analyserOutputI: number;
    analyserOutput?: AnalyserNode,
    inputs?: { [deviceId: string]: MediaStreamAudioSourceNode | MediaElementAudioSourceNode },
    currentInput?: string;
    mediaDestination?: MediaStreamAudioDestinationNode,
    dsp?: FaustScriptProcessorNode | FaustAudioWorkletNode,
    dspConnectedToOutput: boolean,
    dspConnectedToInput: boolean,
    inputEnabled: boolean,
    outputEnabled: boolean
};
type FaustEditorMIDIEnv = {
    input: Input
};
type FaustEditorUIEnv = {
    analysersInited: boolean,
    inputAnalyser: 0 | 1, // 0 scope, 1 spect
    outputAnalyser: 0 | 1,
};
type FaustEditorCompileOptions = {
    name: string,
    useWorklet: boolean,
    bufferSize: 128 | 256 | 512 | 1024 | 2048 | 4096,
    saveParams: boolean,
    saveDsp: boolean,
    voices: number,
    args: { [key: string]: any }
};
type FaustExportTargets = { [platform: string]: string[] };
$(async () => {
    const audioEnv = { dspConnectedToInput: false, dspConnectedToOutput: false, analyserInputI: 0, analyserOutputI: 0, inputEnabled: false, outputEnabled: false } as FaustEditorAudioEnv;
    const midiEnv = { input: null } as FaustEditorMIDIEnv;
    const uiEnv = { analysersInited: false, inputAnalyser: 0, outputAnalyser: 0 } as FaustEditorUIEnv;
    const compileOptions = { name: "untitled", useWorklet: false, bufferSize: 1024, saveParams: false, saveDsp: false, voices: 0, args: { "-I": "https://faust.grame.fr/tools/editor/libraries/" }, ...loadEditorParams() } as FaustEditorCompileOptions;
    const faustEnv = { audioEnv, midiEnv, uiEnv, compileOptions, jQuery } as FaustEditorEnv;
    // Tooltips
    $('[data-toggle="tooltip"]').tooltip({ trigger: "hover" });
    $("#btn-export").tooltip({ trigger: "hover" });
    // Voices
    $("#select-voices").on("change", (e) => {
        compileOptions.voices = +(e.currentTarget as HTMLInputElement).value;
        saveEditorParams(compileOptions);
    }).children(`option[value=${compileOptions.voices}]`).prop("selected", true);
    // BufferSize
    $("#select-buffer-size").on("change", (e) => {
        compileOptions.bufferSize = +(e.currentTarget as HTMLInputElement).value as 128 | 256 | 512 | 1024 | 2048 | 4096;
        saveEditorParams(compileOptions);
    }).children(`option[value=${compileOptions.bufferSize}]`).prop("selected", true);
    // AudioWorklet
    $("#check-worklet").on("change", (e) => {
        compileOptions.useWorklet = (e.currentTarget as HTMLInputElement).checked;
        if (compileOptions.useWorklet) $("#select-buffer-size").prop("disabled", true).children("option").eq(0).prop("selected", true);
        else $("#select-buffer-size").prop("disabled", false).children("option").eq([128, 256, 512, 1024, 2048, 4096].indexOf(compileOptions.bufferSize)).prop("selected", true);
        saveEditorParams(compileOptions);
    });
    if (window.AudioWorklet) $("#check-worklet").prop({ disabled: false, checked: true }).change();
    // Save Params
    ($("#check-save-params").on("change", (e) => {
        compileOptions.saveParams = (e.currentTarget as HTMLInputElement).checked;
        saveEditorParams(compileOptions);
    })[0] as HTMLInputElement).checked = compileOptions.saveParams;
    // Save DSP
    ($("#check-save-dsp").on("change", (e) => {
        compileOptions.saveDsp = (e.currentTarget as HTMLInputElement).checked;
        saveEditorParams(compileOptions);
    })[0] as HTMLInputElement).checked = compileOptions.saveDsp;
    // MIDI Devices
    const key2Midi = new Key2Midi({ enabled: false });
    document.addEventListener("keydown", (e) => {
        if (faustEnv.editor && faustEnv.editor.hasTextFocus()) return;
        key2Midi.handleKeyDown(e.key);
    });
    document.addEventListener("keyup", (e) => {
        if (faustEnv.editor && faustEnv.editor.hasTextFocus()) return;
        key2Midi.handleKeyUp(e.key);
    });
    $("#select-midi-input").on("change", (e) => {
        const id = (e.currentTarget as HTMLSelectElement).value;
        if (midiEnv.input) midiEnv.input.removeListener("midimessage", "all");
        const listener = (data: number[] | Uint8Array) => { if (audioEnv.dsp) audioEnv.dsp.midiMessage(data); };
        if (id === "-2") {
            key2Midi.handler = listener;
            key2Midi.enabled = true;
            return;
        }
        key2Midi.enabled = false;
        if (id === "-1") return;
        const input = webmidi.getInputById(id);
        if (!input) return;
        midiEnv.input = input;
        input.addListener("midimessage", "all", e => listener(e.data));
    });
    webmidi.enable((e) => {
        if (e) return;
        $("#midi-ui-default").hide();
        const $select = $("#select-midi-input").prop("disabled", false);
        webmidi.inputs.forEach(input => $select.append(new Option(input.name, input.id)));
        if (webmidi.inputs.length) $select.children("option").eq(2).prop("selected", true).change();
    });
    // Audio Inputs
    let wavesurfer: WaveSurfer;
    $("#select-audio-input").on("change", async (e) => {
        const id = (e.currentTarget as HTMLSelectElement).value;
        if (audioEnv.currentInput === id) return;
        if (audioEnv.audioCtx) {
            const splitter = audioEnv.splitterInput;
            const analyser = audioEnv.analyserInput;
            const dsp = audioEnv.dsp;
            const input = audioEnv.inputs[audioEnv.currentInput];
            if (splitter) input.disconnect(splitter);
            if (dsp && audioEnv.dspConnectedToInput && dsp.getNumInputs()) { // Disconnect
                input.disconnect(dsp);
                audioEnv.dspConnectedToInput = false;
            }
        }
        // MediaElementSource, Waveform
        if (id === "-1") $("#source-ui").show();
        else $("#source-ui").hide();
        await initAudioCtx(audioEnv);
        initAnalysersUI(uiEnv, audioEnv);
        if (!wavesurfer) {
            wavesurfer = WaveSurfer.create({
                container: $("#source-waveform")[0],
                audioContext: audioEnv.audioCtx,
                backend: "MediaElement",
                cursorColor: "#EEE",
                progressColor: "#888",
                waveColor: "#BBB",
                height: 60,
                splitChannels: true
            });
            wavesurfer.on("play", () => $("#btn-source-play .fa-play").removeClass("fa-play").addClass("fa-pause"));
            wavesurfer.on("pause", () => $("#btn-source-play .fa-pause").removeClass("fa-pause").addClass("fa-play"));
            wavesurfer.on("finish", () => {
                if ($("#btn-source-loop").hasClass("active")) wavesurfer.play();
                else $("#btn-source-play .fa-pause").removeClass("fa-pause").addClass("fa-play");
            });
            wavesurfer.load("./02-XYLO1.mp3");
            if ($("#source-waveform audio").length) {
                audioEnv.inputs[-1] = audioEnv.audioCtx.createMediaElementSource($("#source-waveform audio")[0] as HTMLMediaElement);
            }
        }
        await initAudioCtx(audioEnv, id);
        const splitter = audioEnv.splitterInput;
        const analyser = audioEnv.analyserInput;
        const dsp = audioEnv.dsp;
        const input = audioEnv.inputs[id];
        audioEnv.currentInput = id;
        audioEnv.inputEnabled = true;
        if (splitter) input.connect(splitter);
        if (dsp && dsp.getNumInputs()) {
            input.connect(dsp);
            audioEnv.dspConnectedToInput = true;
        }
    }).change();
    // Waveform
    $("#btn-source-play").on("click", (e) => {
        if (!wavesurfer || !wavesurfer.isReady) return;
        if (wavesurfer.isPlaying()) {
            wavesurfer.pause();
        } else {
            wavesurfer.play();
        }
    });
    $("#btn-source-rewind").on("click", (e) => {
        if (!wavesurfer.isReady) return;
        wavesurfer.seekTo(0);
    });
    $("#btn-source-loop").on("click", (e) => {
        $(e.currentTarget).toggleClass("active");
    });
    $("#source-waveform").on("dragenter dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("#source-overlay").show();
    });
    $("#source-overlay").on("dragleave dragend", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $(e.currentTarget).hide();
    });
    $("#source-overlay").on("dragenter dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    $("#source-overlay").on("drop", (e) => {
        $(e.currentTarget).hide();
        if (!wavesurfer.isReady) return;
        const event = e.originalEvent as DragEvent;
        if (event.dataTransfer && event.dataTransfer.files.length) {
            // Stop the propagation of the event
            e.preventDefault();
            e.stopPropagation();
            const splitter = audioEnv.splitterInput;
            const analyser = audioEnv.analyserInput;
            const dsp = audioEnv.dsp;
            let input = audioEnv.inputs[-1];
            if (analyser && input) input.disconnect(splitter);
            if (dsp && audioEnv.dspConnectedToInput && dsp.getNumInputs()) { // Disconnect
                input.disconnect(dsp);
                audioEnv.dspConnectedToInput = false;
            }
            audioEnv.inputEnabled = false;

            const file = event.dataTransfer.files[0];
            try {
                wavesurfer.load(URL.createObjectURL(file));
            } catch (e) {
                console.error(e);
                return;
            }
            if ($("#source-waveform audio").length) {
                audioEnv.inputs[-1] = audioEnv.audioCtx.createMediaElementSource($("#source-waveform audio")[0] as HTMLMediaElement);
                input = audioEnv.inputs[-1];
            }
            audioEnv.inputEnabled = true;
            if (analyser && input) input.connect(splitter);
            if (dsp && dsp.getNumInputs()) {
                input.connect(dsp);
                audioEnv.dspConnectedToInput = true;
            }
        }
    });
    navigator.mediaDevices.enumerateDevices().then((devices) => {
        $("#input-ui-default").hide();
        const $select = $("#select-audio-input").prop("disabled", false);
        devices.forEach((device) => {
            if (device.kind === "audioinput") $select.append(new Option(device.label || device.deviceId, device.deviceId));
        });
    });
    // DSP
    refreshDspUI();
    // Output
    $("#btn-dac").on("click", async (e) => {
        /*
        if (!audioEnv.audioCtx) {
            await initAudioCtx(audioEnv);
            $(e.currentTarget).removeClass("btn-light").addClass("btn-primary")
            .children("span").html("Output is On");
        } else if (audioEnv.audioCtx.state === "suspended") {
            audioEnv.audioCtx.resume();
            $(e.currentTarget).removeClass("btn-light").addClass("btn-primary")
            .children("span").html("Output is On");
        } else {
            audioEnv.audioCtx.suspend();
            $(e.currentTarget).removeClass("btn-primary").addClass("btn-light")
            .children("span").html("Output is Off");
        }
        */
        if (audioEnv.outputEnabled) {
            $(e.currentTarget).removeClass("btn-primary").addClass("btn-light")
            .children("span").html("Output is Off");
            audioEnv.outputEnabled = false;
            if (audioEnv.dspConnectedToOutput) {
                audioEnv.dsp.disconnect(audioEnv.audioCtx.destination);
                audioEnv.dspConnectedToOutput = false;
            }
        } else {
            audioEnv.outputEnabled = true;
            if (!audioEnv.audioCtx) {
                await initAudioCtx(audioEnv);
                initAnalysersUI(uiEnv, audioEnv);
            } else if (audioEnv.dsp) {
                audioEnv.dsp.connect(audioEnv.audioCtx.destination);
                audioEnv.dspConnectedToOutput = true;
            }
            $(e.currentTarget).removeClass("btn-light").addClass("btn-primary")
            .children("span").html("Output is On");
        }
    });
    // Upload
    $("#btn-upload").on("click", (e) => {
        $("#input-upload").click();
    });
    $("#input-upload").on("input", (e) => {
        const file = (e.currentTarget as HTMLInputElement).files[0];
        const reader = new FileReader();
        reader.onload = () => {
            compileOptions.name = file.name.split(".").slice(0, -1).join(".");
            editor.setValue(reader.result.toString());
            saveEditorParams(compileOptions);
        };
        reader.onerror = () => undefined;
        reader.readAsText(file);
    }).on("click", e => e.stopPropagation());
    // Save as
    $("#btn-save").on("click", (e) => {
        const text = editor.getValue();
        const uri = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
        $("#a-save").attr({ href: uri, download: compileOptions.name + ".dsp" })[0].click();
    });
    $("#a-save").on("click", e => e.stopPropagation());
    // Docs
    $("#btn-docs").on("click", e => $("#a-docs")[0].click());
    $("#a-docs").on("click", e => e.stopPropagation());
    // Export
    const server = "https://faustservicecloud.grame.fr";
    fetch(`${server}/targets`)
    .then(response => response.json())
    .then((targets: FaustExportTargets) => {
        const plats = Object.keys(targets);
        if (plats.length) {
            $("#export-platform").add("#export-arch").empty();
            plats.forEach((plat, i) => $("#export-platform").append(new Option(plat, plat, i === 0)));
            targets[plats[0]].forEach((arch, i) => $("#export-arch").append(new Option(arch, arch, i === 0)));
        }
        $("#modal-export").on("shown.bs.modal", () => $("#export-name").val(compileOptions.name));
        $("#export-platform").on("change", (e) => {
            const plat = (e.currentTarget as HTMLSelectElement).value;
            $("#export-arch").empty();
            targets[plat].forEach((arch, i) => $("#export-arch").append(new Option(arch, arch, i === 0)));
        });
        $("#export-download").on("click", e => $("#a-export-download")[0].click());
        $("#a-export-download").on("click", e => e.stopPropagation());
        $("#export-submit").on("click", () => {
            $("#export-download").hide();
            $("#export-loading").css("display", "inline-block");
            $("#qr-code").hide();
            $("#export-error").hide();
            const form = new FormData();
            form.append("file", new File([editor.getValue()], `${$("#export-name").val()}.dsp`));
            $.ajax({
                method: "POST",
                url: `${server}/filepost`,
                data: form,
                contentType: false,
                processData: false
            }).done((shaKey) => {
                const matched = shaKey.match(/^[0-9A-Fa-f]+$/);
                if (matched) {
                    const plat = $("#export-platform").val();
                    const arch = $("#export-arch").val();
                    const path = `${server}/${shaKey}/${plat}/${arch}`;
                    $.ajax({
                        method: "GET",
                        url: `${path}/precompile`
                    }).done((result) => {
                        if (result === "DONE") {
                            const href = `${path}/${plat === "android" ? "binary.apk" : "binary.zip"}`;
                            $("#a-export-download").attr({ href })[0];
                            $("#export-download").show();
                            $("#qr-code").show();
                            QRCode.toCanvas(
                                $("#qr-code")[0] as HTMLCanvasElement,
                                `${path}/${plat === "android" ? "binary.apk" : "binary.zip"}`,
                            );
                            return;
                        }
                        $("#export-loading").css("display", "none");
                        $("#export-error").html(result).show();
                    }).fail((jqXHR, textStatus) => {
                        $("#export-error").html(textStatus + ": " + jqXHR.responseText).show();
                    }).always(() => $("#export-loading").css("display", "none"));
                    return;
                }
                $("#export-loading").css("display", "none");
                $("#export-error").html(shaKey).show();
            }).fail((jqXHR, textStatus) => {
                $("#export-loading").css("display", "none");
                $("#export-error").html(textStatus + ": " + jqXHR.responseText).show();
            });
        });
    });
    // Editor
    const editor = await initEditor();
    faustEnv.editor = editor;
    editor.onKeyUp(() => localStorage.setItem("faust_editor_code", editor.getValue()));
    $("#tab-editor").tab("show").on("shown.bs.tab", () => editor.layout());
    $("#center").on("dragenter dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("#editor-overlay").show();
    });
    $("#editor-overlay").on("dragleave dragend", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $(e.currentTarget).hide();
    });
    $("#editor-overlay").on("dragenter dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    $("#editor-overlay").on("drop", (e) => {
        $(e.currentTarget).hide();
        const event = e.originalEvent as DragEvent;
        if (event.dataTransfer && event.dataTransfer.files.length) {
            // Stop the propagation of the event
            e.preventDefault();
            e.stopPropagation();
            const file = event.dataTransfer.files[0];
            const reader = new FileReader();
            reader.onload = () => {
                compileOptions.name = file.name.split(".").slice(0, -1).join(".");
                editor.setValue(reader.result.toString());
                localStorage.setItem("faust_editor_code", editor.getValue());
                saveEditorParams(compileOptions);
            };
            reader.onerror = () => undefined;
            reader.readAsText(file);
        }
    });
    // Faust Core
    const { Faust } = await import("faust2webaudio");
    const faust = new Faust();
    await faust.ready;
    $("#btn-run").prop("disabled", false).on("click", async (e) => {
        const audioCtx = audioEnv.audioCtx;
        const input = audioEnv.inputs[audioEnv.currentInput];
        let splitter = audioEnv.splitterOutput;
        const analyser = audioEnv.analyserOutput;
        if (!audioCtx) {
            await initAudioCtx(audioEnv);
            initAnalysersUI(uiEnv, audioEnv);
        } else if (audioEnv.dsp) { // Disconnect current
            const dsp = audioEnv.dsp;
            if (audioEnv.dspConnectedToInput) {
                input.disconnect(dsp);
                audioEnv.dspConnectedToInput = false;
            }
            dsp.disconnect();
            audioEnv.dspConnectedToOutput = false;
        }
        const { useWorklet, bufferSize, voices, args } = compileOptions;
        const code = editor.getValue();
        let node: FaustScriptProcessorNode | FaustAudioWorkletNode;
        let svg: string;
        try {
            node = await faust.getNode(code, { audioCtx, useWorklet, bufferSize, voices, args });
            svg = faust.getDiagram(code, ["-I", args["-I"]]);
        } catch (e) {
            const uiWindow = ($("#iframe-faust-ui")[0] as HTMLIFrameElement).contentWindow;
            uiWindow.postMessage(JSON.stringify({ type: "clear" }), "*");
            $("#faust-ui-default").add("#diagram-default").show();
            $("#iframe-faust-ui").add("#diagram-svg").hide();
            $("#output-analyser-ui").hide();
            refreshDspUI();
            throw e;
        }
        if (node) {
            let dspParams = {} as { [path: string]: number };
            if (compileOptions.saveParams) {
                const strDspParams = localStorage.getItem("faust-editor-dsp-params");
                if (strDspParams) {
                    dspParams = JSON.parse(strDspParams);
                    for (const path in dspParams) {
                        if (node.getParams().indexOf(path) !== -1) {
                            node.setParamValue(path, dspParams[path]);
                        }
                    }
                }
            }
            audioEnv.dsp = node;
            const channelsCount = node.getNumOutputs();
            if (!splitter || splitter.numberOfOutputs !== channelsCount) {
                if (splitter) splitter.disconnect(analyser);
                splitter = audioCtx.createChannelSplitter(channelsCount);
                delete audioEnv.splitterOutput;
                audioEnv.splitterOutput = splitter;
                if (audioEnv.analyserOutputI > channelsCount - 1) {
                    audioEnv.analyserOutputI = channelsCount - 1;
                    $("#btn-output-analyser-ch").html("ch " + (audioEnv.analyserOutputI + 1).toString());
                }
                splitter.connect(analyser, audioEnv.analyserOutputI);
            }
            if (audioEnv.inputEnabled && node.getNumInputs()) {
                audioEnv.inputs[audioEnv.currentInput].connect(node);
                audioEnv.dspConnectedToInput = true;
            }
            node.connect(splitter);
            if (audioEnv.outputEnabled) {
                node.connect(audioEnv.audioCtx.destination);
                audioEnv.dspConnectedToOutput = true;
            }
            const bindUI = () => {
                const uiWindow = ($("#iframe-faust-ui")[0] as HTMLIFrameElement).contentWindow;
                uiWindow.postMessage(JSON.stringify({ type: "ui", json: node.getJSON() }), "*");
                node.setOutputParamHandler((path: string, value: number) => uiWindow.postMessage(JSON.stringify({ path, value, type: "param" }), "*"));
                if (compileOptions.saveParams) {
                    const params = node.getParams();
                    for (const path in dspParams) {
                        if (params.indexOf(path) !== -1) uiWindow.postMessage(JSON.stringify({ path, value: dspParams[path], type: "param" }), "*");
                    }
                }
            };
            $("#diagram-svg").empty().html(svg);
            $("#faust-ui-default").add("#diagram-default").hide();
            $("#iframe-faust-ui").add("#diagram-svg").show();
            $("#output-analyser-ui").show();
            if ($("#tab-faust-ui").hasClass("active")) bindUI();
            else $("#tab-faust-ui").tab("show").one("shown.bs.tab", bindUI);
            refreshDspUI(node);
            // const dspOutputHandler = FaustUI.main(node.getJSON(), $("#faust-ui"), (path: string, val: number) => node.setParamValue(path, val));
            // node.setOutputParamHandler(dspOutputHandler);
        }
    });
    const dspParams = {} as { [path: string]: number };
    window.addEventListener("message", (e) => {
        const data = JSON.parse(e.data);
        if (data.type === "param") {
            if (audioEnv.dsp) audioEnv.dsp.setParamValue(data.path, +data.value);
            if (compileOptions.saveParams) {
                dspParams[data.path] = +data.value;
                localStorage.setItem("faust-editor-dsp-params", JSON.stringify(dspParams));
            }
            return;
        }
        if (data.type === "keydown") return key2Midi.handleKeyDown(data.key);
        if (data.type === "keyup") return key2Midi.handleKeyUp(data.key);
    });
    // svg hook
    $("#diagram-svg").on("click", "a", (e) => {
        e.preventDefault();
        const fileName = (e.currentTarget as SVGAElement).href.baseVal;
        const svg = faust.readFile("FaustDSP-svg/" + fileName);
        $("#diagram-svg").empty().html(svg);
    });
    // Analysers
    $("#output-analyser-ui").hide();
    window.faustEnv = faustEnv;
});
const initAudioCtx = async (audioEnv: FaustEditorAudioEnv, deviceId?: string) => {
    if (!audioEnv.audioCtx) {
        const audioCtx = new (window.webkitAudioContext || window.AudioContext)();
        audioEnv.audioCtx = audioCtx;
        audioEnv.outputEnabled = true;
        audioCtx.addEventListener("statechange", () => {
            if (audioCtx.state === "running") {
                audioEnv.outputEnabled = true;
                $("#btn-dac").removeClass("btn-light").addClass("btn-primary")
                .children("span").html("Output is On");
            } else {
                audioEnv.outputEnabled = false;
                $("#btn-dac").removeClass("btn-primary").addClass("btn-light")
                .children("span").html("Output is Off");
            }
        });
        const unlockAudioContext = () => {
            if (audioCtx.state !== "suspended") return;
            const unlock = (): any => audioCtx.resume().then(clean);
            const clean = () => $("body").off("touchstart touchend mousedown keydown", unlock);
            $("body").on("touchstart touchend mousedown keydown", unlock);
        };
        unlockAudioContext();
    }
    if (audioEnv.audioCtx.state !== "running") audioEnv.audioCtx.resume();
    if (!audioEnv.inputs) audioEnv.inputs = {};
    if (deviceId && !audioEnv.inputs[deviceId]) {
        if (deviceId === "-1") {
            if ($("#source-waveform audio").length) audioEnv.inputs[deviceId] = audioEnv.audioCtx.createMediaElementSource($("#source-waveform audio")[0] as HTMLMediaElement);
        } else {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId } });
            audioEnv.inputs[deviceId] = audioEnv.audioCtx.createMediaStreamSource(stream);
        }
    }
    if (!audioEnv.splitterInput) audioEnv.splitterInput = audioEnv.audioCtx.createChannelSplitter(2);
    if (!audioEnv.analyserInput) audioEnv.analyserInput = audioEnv.audioCtx.createAnalyser();
    if (!audioEnv.analyserOutput) audioEnv.analyserOutput = audioEnv.audioCtx.createAnalyser();
    audioEnv.splitterInput.connect(audioEnv.analyserInput, 0);
    if (!audioEnv.mediaDestination) {
        try {
            audioEnv.mediaDestination = audioEnv.audioCtx.createMediaStreamDestination();
        } catch (e) {}
    }
    return audioEnv;
};
const initAnalysersUI = (uiEnv: FaustEditorUIEnv, audioEnv: FaustEditorAudioEnv) => {
    if (uiEnv.analysersInited) return;
    $("#btn-input-analyser-switch").on("click", (e) => {
        if (uiEnv.inputAnalyser === 0) {
            uiEnv.inputAnalyser = 1;
            $(e.currentTarget).children(".fa-wave-square").removeClass("fa-wave-square").addClass("fa-chart-bar");
        } else {
            uiEnv.inputAnalyser = 0;
            $(e.currentTarget).children(".fa-chart-bar").removeClass("fa-chart-bar").addClass("fa-wave-square");
        }
    });
    $("#btn-output-analyser-switch").on("click", (e) => {
        if (uiEnv.outputAnalyser === 0) {
            uiEnv.outputAnalyser = 1;
            $(e.currentTarget).children(".fa-wave-square").removeClass("fa-wave-square").addClass("fa-chart-bar");
        } else {
            uiEnv.outputAnalyser = 0;
            $(e.currentTarget).children(".fa-chart-bar").removeClass("fa-chart-bar").addClass("fa-wave-square");
        }
    });
    const audioCtx = audioEnv.audioCtx;
    const iNode = audioEnv.analyserInput;
    const oNode = audioEnv.analyserOutput;
    const w = 170;
    const h = 100;
    let iT = new Uint8Array(iNode.fftSize);
    let iF = new Uint8Array(iNode.frequencyBinCount);
    let oT = new Uint8Array(oNode.fftSize);
    let oF = new Uint8Array(oNode.frequencyBinCount);
    const iCanvas = $("#input-analyser")[0] as HTMLCanvasElement;
    iCanvas.width = 170;
    iCanvas.height = 100;
    const iCtx = iCanvas.getContext("2d");
    iCtx.strokeStyle = "#FFFFFF";
    const oCanvas = $("#output-analyser")[0] as HTMLCanvasElement;
    oCanvas.width = 170;
    oCanvas.height = 100;
    const oCtx = oCanvas.getContext("2d");
    oCtx.strokeStyle = "#FFFFFF";
    const sizes = [128, 512, 2048, 8192];
    $("#btn-input-analyser-size").on("click", (e) => {
        const size = sizes[(sizes.indexOf(iNode.fftSize) + 1) % 4];
        iNode.fftSize = size;
        iT = new Uint8Array(iNode.fftSize);
        iF = new Uint8Array(iNode.frequencyBinCount);
        $(e.currentTarget).html(size.toString() + " samps");
    });
    $("#btn-output-analyser-size").on("click", (e) => {
        const size = sizes[(sizes.indexOf(oNode.fftSize) + 1) % 4];
        oNode.fftSize = size;
        oT = new Uint8Array(oNode.fftSize);
        oF = new Uint8Array(oNode.frequencyBinCount);
        $(e.currentTarget).html(size.toString() + " samps");
    });
    $("#btn-input-analyser-ch").on("click", (e) => {
        const iSplitter = audioEnv.splitterInput;
        const oldI = audioEnv.analyserInputI;
        const i = (oldI + 1) % 2;
        if (i === oldI) return;
        iSplitter.connect(iNode, i, 0); // Need to be done in the order, or Chrome inspect the graph and disable the analyser.
        setTimeout(() => iSplitter.disconnect(iNode, oldI, 0), 10);
        audioEnv.analyserInputI = i;
        $(e.currentTarget).html("ch " + (i + 1).toString());
    });
    $("#btn-output-analyser-ch").on("click", (e) => {
        const oSplitter = audioEnv.splitterOutput;
        const oldI = audioEnv.analyserOutputI;
        const i = (oldI + 1) % audioEnv.dsp.getNumOutputs();
        if (i === oldI) return;
        oSplitter.connect(oNode, i, 0);
        setTimeout(() => oSplitter.disconnect(oNode, oldI, 0), 10);
        audioEnv.analyserOutputI = i;
        $(e.currentTarget).html("ch " + (i + 1).toString());
    });
    const draw = () => {
        if (!audioCtx || audioCtx.state !== "running") return requestAnimationFrame(draw);
        if (iNode && audioEnv.inputEnabled) {
            if (uiEnv.inputAnalyser === 0) {
                const l = iT.length;
                iNode.getByteTimeDomainData(iT);
                iCtx.fillStyle = "#000000";
                iCtx.fillRect(0, 0, w, h);
                iCtx.beginPath();
                for (let i = 0; i < l; i++) {
                    const x = w * i / (l - 1);
                    const y = h - iT[i] / 128.0 * (h / 2);
                    if (i === 0) iCtx.moveTo(x, y);
                    else iCtx.lineTo(x, y);
                }
                iCtx.stroke();
            } else if (uiEnv.inputAnalyser === 1) {
                const l = iF.length;
                iNode.getByteFrequencyData(iF);
                iCtx.fillStyle = "#000000";
                iCtx.fillRect(0, 0, w, h);
                iCtx.fillStyle = "#FFFFFF";
                for (let i = 0; i < l; i++) {
                    const x = w * i / l;
                    const y = iF[i] / 128.0 * h;
                    iCtx.fillRect(x, h - y, w / l, y);
                }
            }
        }
        if (oNode && audioEnv.dsp) {
            if (uiEnv.outputAnalyser === 0) {
                const l = oT.length;
                oNode.getByteTimeDomainData(oT);
                oCtx.fillStyle = "#000000";
                oCtx.fillRect(0, 0, w, h);
                oCtx.beginPath();
                for (let i = 0; i < l; i++) {
                    const x = w * i / (l - 1);
                    const y = h - oT[i] / 128.0 * (h / 2);
                    if (i === 0) oCtx.moveTo(x, y);
                    else oCtx.lineTo(x, y);
                }
                oCtx.stroke();
            } else if (uiEnv.outputAnalyser === 1) {
                const l = oF.length;
                oNode.getByteFrequencyData(oF);
                oCtx.fillStyle = "#000000";
                oCtx.fillRect(0, 0, w, h);
                oCtx.fillStyle = "#FFFFFF";
                for (let i = 0; i < l; i++) {
                    const x = w * i / l;
                    const y = oF[i] / 128.0 * h;
                    oCtx.fillRect(x, h - y, w / l, y);
                }
            }
        }
        return requestAnimationFrame(draw);
    };
    uiEnv.analysersInited = true;
    draw();
};
const refreshDspUI = (node?: FaustAudioWorkletNode | FaustScriptProcessorNode) => {
    if (!node) {
        $("#dsp-ui-detail").hide();
        $("#dsp-ui-default").removeClass("badge-success").addClass("badge-warning").html("no DSP yet");
        return;
    }
    $("#dsp-ui-detail").show();
    if (node instanceof ScriptProcessorNode) {
        $("#dsp-ui-default").removeClass("badge-success").addClass("badge-warning").html("ScriptProcessor");
    } else {
        $("#dsp-ui-default").removeClass("badge-warning").addClass("badge-success").html("AudioWorklet");
    }
    $("#dsp-ui-detail-inputs").html(node.getNumInputs().toString());
    $("#dsp-ui-detail-outputs").html(node.getNumOutputs().toString());
    $("#dsp-ui-detail-params").html(node.getParams().length.toString());
};
const saveEditorParams = (compileOptions: FaustEditorCompileOptions) => {
    const str = JSON.stringify(compileOptions);
    localStorage.setItem("faust-editor-params", str);
};
const loadEditorParams = (): FaustEditorCompileOptions | {} => {
    const str = localStorage.getItem("faust-editor-params");
    if (!str) return {};
    try {
        return JSON.parse(localStorage.getItem("faust-editor-params")) as FaustEditorCompileOptions;
    } catch (e) {
        return {};
    }
};
const initEditor = async () => {
    const code =
`import("stdfaust.lib");
process = ba.pulsen(1, 10000) : pm.djembe(60, 0.3, 0.4, 1) <: dm.freeverb_demo;`;
    const polycode =
`import("stdfaust.lib");
process = ba.pulsen(1, ba.hz2midikey(freq) * 1000) : pm.marimba(freq, 0, 7000, 0.5, 0.8) * gate * gain with {
    freq = hslider("freq", 440, 40, 8000, 1);
    gain = hslider("gain", 0.5, 0, 1, 0.01);
    gate = button("gate");
};
effect = dm.freeverb_demo;`;
    const monaco = await import("monaco-editor");
    monaco.languages.register({
        id: "faust",
        extensions: ["dsp", "lib"],
        mimetypes: ["application/faust"]
    });
    const faustKeywords = [
        "import", "component", "declare", "library", "environment", "int", "float",
        "letrec", "with", "class", "process", "effect", "inputs", "outputs",
    ];
    const faustFunctions = [
        "mem", "prefix", "rdtable", "rwtable",
        "select2", "select3", "ffunction", "fconstant", "fvariable",
        "button", "checkbox", "vslider", "hslider", "nentry",
        "vgroup", "hgroup", "tgroup", "vbargraph", "hbargraph", "attach",
        "acos", "asin", "atan", "atan2", "cos", "sin", "tan", "exp",
        "log", "log10", "pow", "sqrt", "abs", "min", "max", "fmod",
        "remainder", "floor", "ceil", "rint",
        "seq", "par", "sum", "prod"
    ];
    const faustLib = [
        "an.amp_follower", "an.amp_follower_ud", "an.mth_octave_analyzer", "an.mth_octave_spectral_level6e",
        "an.third_octave_analyzer", "an.third_octave_filterbank", "an.half_octave_analyzer", "an.half_octave_filterbank",
        "an.analyzer", "an.ifft", "an.amp_follower_ar",
        "ba.samp2sec", "ba.sec2samp", "ba.db2linear", "ba.linear2db", "ba.lin2LogGain", "ba.log2LinGain",
        "ba.tau2pole", "ba.pole2tau", "ba.midikey2hz", "ba.hz2midikey", "ba.pianokey2hz", "ba.hz2pianokey",
        "ba.countdown", "ba.countup", "ba.sweep", "ba.time", "ba.tempo", "ba.period", "ba.pulse", "ba.pulsen",
        "ba.cycle", "ba.beat", "ba.pulse_countup", "ba.pulse_countdown", "ba.pulse_countup_loop",
        "ba.resetCtr", "ba.pulse_countdown_loop", "ba.count", "ba.take", "ba.subseq",
        "ba.if", "ba.selector", "ba.selectn", "ba.select2stereo", "ba.latch", "ba.sAndH",
        "ba.downSample", "ba.peakhold", "ba.peakholder", "ba.impulsify", "ba.automat", "ba.bpf", "ba.listInterp",
        "ba.bypass1", "ba.bypass2", "ba.bypass1to2", "ba.toggle", "ba.on_and_off", "ba.selectoutn",
        "co.compressor_mono", "co.compressor_stereo", "co.limiter_1176_R4_mono", "co.limiter_1176_R4_stereo",
        "de.delay", "de.fdelay", "de.sdelay", "de.fdelay", "de.fdelayn", "de.fdelaya", "de.fdelayna",
        "dm.mth_octave_spectral_level_demo", "dm.parametric_eq_demo", "dm.spectral_tilt_demo",
        "dm.cubicnl_demo", "dm.gate_demo", "dm.compressor_demo", "dm.moog_vcf_demo", "dm.wah4_demo",
        "dm.crybaby_demo", "dm.flanger_demo", "dm.phaser2_demo", "dm.stereo_reverb_tester", "dm.fdnrev0_demo",
        "dm.zita_rev_fdn_demo", "dm.zita_rev1", "dm.sawtooth_demo", "dm.virtual_analog_oscillator_demo",
        "dm.exciter", "dm.vocoder_demo", "dm.freeverb_demo", "dx.dx7_ampf", "dx.dx7_egraterisef",
        "dx.dx7_egraterisepercf", "dx.dx7_egratedecayf", "dx.dx7_egratedecaypercf", "dx.dx7_eglv2peakf",
        "dx.dx7_velsensf", "dx.dx7_fdbkscalef", "dx.dx7_op", "dx.dx7_algo", "dx.dx7_ui",
        "en.smoothEnvelope", "en.ar", "en.arfe", "en.are", "en.asr", "en.adsr", "en.dx7envelope", "en.adsre",
        "fi.zero", "fi.pole", "fi.integrator", "fi.dcblockerat", "fi.dcblocker", "fi.ff_comb", "fi.ff_fcomb",
        "fi.ffcombfilter", "fi.fb_comb", "fi.fb_fcomb", "fi.rev1", "fi.allpass_comb", "fi.allpass_fcomb",
        "fi.rev2", "fi.iir", "fi.notchw", "fi.av2sv", "fi.bvav2nuv", "fi.iir_lat2", "fi.allpassnt", "fi.iir_kl",
        "fi.allpassnklt", "fi.iir_lat1", "fi.allpassn1mt", "fi.iir_nl", "fi.allpassnnlt", "fi.tf2np", "fi.wgr",
        "fi.nlf2", "fi.apnl", "fi.allpassn", "fi.allpassnn", "fi.allpasskl", "fi.allpass1m", "fi.tf3slf",
        "fi.tf1s", "fi.tf2sb", "fi.tf1sb", "fi.resonlp", "fi.resonhp", "fi.resonbp", "fi.lowpass", "fi.highpass",
        "fi.lowpass0_highpass1", "fi.lowpass3e", "fi.lowpass6e", "fi.highpass3e", "fi.highpass6e", "fi.bandpass",
        "fi.bandstop", "fi.bandpass6e", "fi.bandpass12e", "fi.low_shelf", "fi.high_shelf", "fi.peak_eq",
        "fi.peak_eq_cq", "fi.peak_eq_rm", "fi.spectral_tilt", "fi.levelfilter", "fi.levelfilterN",
        "fi.mth_octave_filterbank[n]", "fi.filterbank", "fi.filterbanki",
        "ho.encoder", "ho.decoder", "ho.decoderStereo", "ho.optimBasic", "ho.optimMaxRe", "ho.optimInPhase",
        "ho.wider", "ho.map", "ho.rotate", "ma.SR", "ma.BS", "ma.PI", "ma.FTZ", "ma.neg", "ma.sub", "ma.inv",
        "ma.cbrt", "ma.hypot", "ma.ldexp", "ma.scalb", "ma.log1p", "ma.logb", "ma.ilogb", "ma.log2", "ma.expm1",
        "ma.acosh", "ma.asinh", "ma.atanh", "ma.sinh", "ma.cosh", "ma.tanh", "ma.erf", "ma.erfc", "ma.gamma",
        "ma.lgamma", "ma.J0", "ma.J1", "ma.Jn", "ma.Y0", "ma.Y1", "ma.Yn", "ma.np2", "ma.frac", "ma.modulo",
        "ma.isnan", "ma.chebychev", "ma.chebychevpoly", "ma.diffn", "ma.signum",
        "ef.cubicnl", "ef.gate_mono", "ef.gate_stereo", "ef.speakerbp", "ef.piano_dispersion_filter",
        "ef.stereo_width", "ef.echo", "ef.transpose", "ef.mesh_square",
        "no.noise", "no.multirandom", "no.multinoise", "no.noises", "no.pink_noise", "no.pink_noise_vm",
        "no.sparse_noise_vm", "no.velvet_noise_vm", "no.gnoise",
        "os.sinwaveform", "os.coswaveform", "os.phasor", "os.hs_phasor", "os.oscsin", "os.hs_oscsin",
        "os.osccos", "os.oscp", "os.osci", "os.lf_imptrain", "os.lf_pulsetrainpos", "os.lf_pulsetrain",
        "os.lf_squarewavepos", "os.lf_squarewave", "os.lf_trianglepos", "os.lf_rawsaw", "os.lf_sawpos_phase",
        "os.sawNp", "os.saw2dpw", "os.saw3", "os.sawtooth", "os.saw2f2", "os.saw2f4", "os.pulsetrainN",
        "os.pulsetrain", "os.squareN", "os.square", "os.impulse", "os.imptrainN", "os.imptrain", "os.triangleN",
        "os.triangle", "os.oscb", "os.oscrq", "os.oscrs", "os.oscrc", "os.osc", "os.oscs", "os.oscw", "os.oscws",
        "os.oscwq", "os.oscw", "os.lf_sawpos", "os.lf_saw", "os.lf_triangle",
        "pf.flanger_mono", "pf.flanger_stereo", "pf.phaser2_mono", "pf.phaser2_stereo",
        "pm.speedOfSound", "pm.maxLength", "pm.f2l", "pm.l2f", "pm.l2s", "pm.basicBlock", "pm.chain",
        "pm.inLeftWave", "pm.inRightWave", "pm.in", "pm.outLeftWave", "pm.outRightWave", "pm.out",
        "pm.terminations", "pm.lTermination", "pm.rTermination", "pm.closeIns", "pm.closeOuts", "pm.endChain",
        "pm.waveguideN", "pm.waveguide", "pm.bridgeFilter", "pm.modeFilter", "pm.stringSegment", "pm.openString",
        "pm.nylonString", "pm.steelString", "pm.openStringPick", "pm.openStringPickUp", "pm.openStringPickDown",
        "pm.ksReflexionFilter", "pm.rStringRigidTermination", "pm.lStringRigidTermination", "pm.elecGuitarBridge",
        "pm.elecGuitarNuts", "pm.guitarBridge", "pm.guitarNuts", "pm.idealString", "pm.ks", "pm.ks_ui_MIDI",
        "pm.elecGuitarModel", "pm.elecGuitar", "pm.elecGuitar_ui_MIDI", "pm.guitarBody", "pm.guitarModel",
        "pm.guitar", "pm.guitar_ui_MIDI", "pm.nylonGuitarModel", "pm.nylonGuitar", "pm.nylonGuitar_ui_MIDI",
        "pm.bowTable", "pm.violinBowTable", "pm.bowInteraction", "pm.violinBow", "pm.violinBowedString",
        "pm.violinNuts", "pm.violinBridge", "pm.violinBody", "pm.violinModel", "pm.violin_ui", "pm.violin_ui_MIDI",
        "pm.openTube", "pm.reedTable", "pm.fluteJetTable", "pm.brassLipsTable", "pm.clarinetReed", "pm.clarinetMouthPiece",
        "pm.brassLips", "pm.fluteEmbouchure", "pm.wBell", "pm.fluteHead", "pm.fluteFoot", "pm.clarinetModel",
        "pm.clarinetModel_ui", "pm.clarinet_ui", "pm.clarinet_ui_MIDI", "pm.brassModel", "pm.brassModel_ui",
        "pm.brass_ui", "pm.brass_ui_MIDI", "pm.fluteModel", "pm.fluteModel_ui", "pm.flute_ui", "pm.flute_ui_MIDI",
        "pm.impulseExcitation", "pm.strikeModel", "pm.strike", "pm.pluckString", "pm.blower", "pm.blower_ui",
        "pm.djembeModel", "pm.djembe", "pm.djembe_ui_MIDI", "pm.marimbaBarModel", "pm.marimbaResTube",
        "pm.marimbaModel", "pm.marimba", "pm.marimba_ui_MIDI", "pm.churchBellModel", "pm.churchBell",
        "pm.churchBell_ui", "pm.englishBellModel", "pm.englishBell", "pm.englishBell_ui", "pm.frenchBellModel",
        "pm.frenchBell", "pm.frenchBell_ui", "pm.germanBellModel", "pm.germanBell", "pm.germanBell_ui",
        "pm.russianBellModel", "pm.russianBell", "pm.russianBell_ui", "pm.standardBellModel", "pm.standardBell",
        "pm.standardBell_ui", "pm.formantValues", "pm.voiceGender", "pm.skirtWidthMultiplier", "pm.autobendFreq",
        "pm.vocalEffort", "pm.fof", "pm.fofSH", "pm.fofCycle", "pm.fofSmooth", "pm.formantFilterFofCycle",
        "pm.formantFilterFofSmooth", "pm.formantFilterBP", "pm.formantFilterbank", "pm.formantFilterbankFofCycle",
        "pm.formantFilterbankFofSmooth", "pm.formantFilterbankBP", "pm.SFFormantModel", "pm.SFFormantModelFofCycle",
        "pm.SFFormantModelFofSmooth", "pm.SFFormantModelBP", "pm.SFFormantModelFofCycle_ui", "pm.SFFormantModelFofSmooth_ui",
        "pm.SFFormantModelBP_ui", "pm.SFFormantModelFofCycle_ui_MIDI", "pm.SFFormantModelFofSmooth_ui_MIDI",
        "pm.SFFormantModelBP_ui_MIDI", "pm.allpassNL",
        "re.jcrev", "re.satrev", "re.fdnrev0", "re.zita_rev_fdn", "re.zita_rev1_stereo", "re.zita_rev1_ambi",
        "re.mono_freeverb", "re.stereo_freeverb",
        "ro.cross", "ro.crossnn", "ro.crossn1", "ro.interleave", "ro.butterfly", "ro.hadamard", "ro.recursivize",
        "si.bus", "si.block", "si.interpolate", "si.smoo", "si.polySmooth", "si.smoothAndH", "si.bsmooth",
        "si.dot", "si.smooth", "si.cbus", "si.cmul", "si.lag_ud", "sp.panner", "sp.spat", "sp.stereoize",
        "sy.popFilterPerc", "sy.dubDub", "sy.sawTrombone", "sy.combString", "sy.additiveDrum", "sy.fm",
        "ve.moog_vcf", "ve.moog_vcf_2b[n]", "ve.wah4", "ve.autowah", "ve.crybaby", "ve.vocoder"
    ];

    monaco.languages.setMonarchTokensProvider("faust", {
        faustKeywords,
        faustFunctions,
        faustLib,
        defaultToken: "invalid",
        tokenPostfix: ".dsp",
        faustCompOperators: [
            "~", ",", ":", "<:", ":>"
        ],
        operators: [
            "=",
            "+", "-", "*", "/", "%", "^",
            "&", "|", "xor", "<<", ">>",
            ">", "<", "==", "<=", ">=", "!=",
            "@", "'"
        ],
        // we include these common regular expressions
        symbols:  /[=><!~?:&|+\-*\/\^%]+/,
        // C# style strings
        escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
        // The main tokenizer for our languages
        tokenizer: {
            root: [
                // identifiers and keywords
                [/!|_/, "keyword"], // Wire
                [/[a-z_$]([\w\.$]*[\w$])?/, { cases: {
                    "@faustFunctions": "faustFunctions",
                    "@faustKeywords": "faustKeywords",
                    "@faustLib": "faustLib",
                    "@default": "identifier"
                } }],
                [/[A-Z][\w\$]*/, "type.identifier"],  // to show class names nicely
                // whitespace
                { include: "@whitespace" },
                // delimiters and operators
                [/[{}()\[\]]/, "@brackets"],
                [/~|,|<:|:>|:/, "faustCompOperators"],
                [/[<>](?!@symbols)/, "@brackets"],
                [/=|\+|\-|\*|\/|%|\^|&|\||xor|<<|>>|>|<|==|<=|>=|!=|@|'/, { cases: {
                    "@operators": "operators",
                    "@default"  : ""
                } }],
                // numbers
                [/\d*\.\d+([eE][\-+]?\d+)?/, "number.float"],
                [/0[xX][0-9a-fA-F]+/, "number.hex"],
                [/\d+/, "number"],
                // delimiter: after number because of .\d floats
                [/[;.]/, "delimiter"],
                // strings
                [/"([^"\\]|\\.)*$/, "string.invalid"],  // non-teminated string
                [/"/,  { token: "string.quote", bracket: "@open", next: "@string" }]
            ],

            comment: [
                [/[^\/*]+/, "comment"],
                [/\/\*/,    "comment", "@push"],    // nested comment
                ["\\*/",    "comment", "@pop"],
                [/[\/*]/,   "comment"]
            ],

            string: [
                [/[^\\"]+/,  "string"],
                [/@escapes/, "string.escape"],
                [/\\./,      "string.escape.invalid"],
                [/"/,        { token: "string.quote", bracket: "@close", next: "@pop" }]
            ],
            whitespace: [
                [/[ \t\r\n]+/, "white"],
                [/\/\*/,       "comment", "@comment"],
                [/\/\/.*$/,    "comment"]
            ]
        }
    } as any);
    monaco.languages.setLanguageConfiguration("faust", {
        comments: {
            lineComment: "//",
            blockComment: ["/*", "*/"]
        },
        brackets: [
            ["{", "}"],
            ["[", "]"],
            ["(", ")"]
        ],
        autoClosingPairs: [
            { open: "{", close: "}" },
            { open: "[", close: "]" },
            { open: "(", close: ")" },
            { open: '"', close: '"', notIn: ["string"] },
            { open: "/**", close: " */", notIn: ["string"] }
        ],
    });
    // Define a new theme that contains only rules that match this language
    monaco.editor.defineTheme("vs-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
            { token: "faustFunctions", foreground: "DDDD99" },
            { token: "faustKeywords", foreground: "4499CC" },
            { token: "faustLib", foreground: "CCCCBB" },
            { token: "faustCompOperators", foreground: "FFDDFF" },
            { token: "identifier", foreground: "77CCFF" }
        ],
        colors: null
    });
    // Register a completion item provider for the new language
    monaco.languages.registerCompletionItemProvider("faust", {
        provideCompletionItems: () => {
            const suggestions = [] as monaco.languages.CompletionItem[];
            [...faustKeywords, ...faustFunctions, ...faustLib].forEach((e) => {
                suggestions.push({
                    label: e,
                    kind: monaco.languages.CompletionItemKind.Text,
                    insertText: e,
                    range: null
                });
            });
            return { suggestions };
        }
    });
    const editor = monaco.editor.create($("#editor")[0], {
        value: localStorage.getItem("faust_editor_code") || code,
        language: "faust",
        theme: "vs-dark",
        dragAndDrop: true,
        mouseWheelZoom: true,
        wordWrap: "on"
    });
    $(window).on("resize", () => editor.layout());
    return editor;
};
