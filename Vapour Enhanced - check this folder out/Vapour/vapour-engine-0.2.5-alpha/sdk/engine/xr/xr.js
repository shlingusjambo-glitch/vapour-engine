/** WebXR session owner. WebXR remains on the main/browser thread; each frame is
 * converted into immutable typed snapshots suitable for one batched WebGPU or
 * WASM submission. Session start must be called from a user gesture for
 * immersive modes, as required by browsers. */
export class XrSessionManager {
    #provider;
    #session;
    #space;
    #mode;
    #referenceSpaceType;
    #frameHandle = 0;
    #callback;
    #presentation;
    #endListeners = new Set();
    constructor(provider = typeof navigator === "undefined" ? {} : navigator) { this.#provider = provider; }
    get active() { return this.#session !== undefined; }
    get mode() { return this.#mode; }
    get referenceSpaceType() { return this.#referenceSpaceType; }
    async supported(mode) { return this.#provider.xr === undefined ? false : this.#provider.xr.isSessionSupported(mode); }
    async start(options = {}) {
        if (this.#session !== undefined)
            throw new Error(`An XR session is already active in mode '${this.#mode}'.`);
        const xr = this.#provider.xr;
        const mode = options.mode ?? "immersive-vr";
        if (xr === undefined)
            throw new Error("WebXR is unavailable. Use a WebXR-capable browser in a secure context and connect a compatible headset.");
        if (!await xr.isSessionSupported(mode))
            throw new Error(`WebXR mode '${mode}' is not supported by this browser/device.`);
        const referenceSpace = options.referenceSpace ?? (mode === "inline" ? "viewer" : "local-floor");
        let session;
        const requiredFeatures = [...(options.requiredFeatures ?? [])];
        const hasGpuBinding = globalThis.XRGPUBinding !== undefined;
        if (options.webGpuPresentation !== undefined && hasGpuBinding && !requiredFeatures.includes("webgpu"))
            requiredFeatures.push("webgpu");
        const sessionOptions = {
            ...(requiredFeatures.length === 0 ? {} : { requiredFeatures }),
            ...(options.optionalFeatures === undefined ? {} : { optionalFeatures: options.optionalFeatures }),
        };
        try {
            session = await xr.requestSession(mode, sessionOptions);
        }
        catch (error) {
            throw new Error(`Could not start WebXR mode '${mode}': ${error instanceof Error ? error.message : String(error)}. Immersive sessions must start from a user gesture and may require headset permission.`, { cause: error });
        }
        try {
            const candidates = uniqueSpaces([referenceSpace, ...(options.referenceSpaceFallbacks ?? (mode === "inline" ? [] : ["local", "viewer"]))]);
            let space, selected;
            const failures = [];
            for (const candidate of candidates) {
                try {
                    space = await session.requestReferenceSpace(candidate);
                    selected = candidate;
                    break;
                }
                catch (error) {
                    failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            if (space === undefined || selected === undefined)
                throw new Error(`None of the requested XR reference spaces are supported (${failures.join("; ")}).`);
            if (options.webGpuPresentation !== undefined)
                this.#presentation = await createGpuPresentation(session, options.webGpuPresentation);
            this.#session = session;
            this.#space = space;
            this.#mode = mode;
            this.#referenceSpaceType = selected;
            session.addEventListener("end", this.#onEnd);
        }
        catch (error) {
            await session.end().catch(() => undefined);
            throw new Error(`WebXR session started but reference-space/presentation setup failed: ${error instanceof Error ? error.message : String(error)}.`, { cause: error });
        }
    }
    startFrameLoop(callback) {
        if (this.#session === undefined || this.#space === undefined)
            throw new Error("Cannot start the XR frame loop before a session and reference space are ready.");
        if (this.#callback !== undefined)
            throw new Error("The XR frame loop is already running.");
        this.#callback = callback;
        this.#frameHandle = this.#session.requestAnimationFrame(this.#onFrame);
    }
    stopFrameLoop() { if (this.#session !== undefined && this.#frameHandle !== 0)
        this.#session.cancelAnimationFrame(this.#frameHandle); this.#frameHandle = 0; this.#callback = undefined; }
    async end() { const session = this.#session; if (session === undefined)
        return; this.stopFrameLoop(); await session.end(); this.#clearSession(); }
    onEnd(listener) { this.#endListeners.add(listener); return () => this.#endListeners.delete(listener); }
    /** Pulses every matching controller. Unsupported actuators return false
     * instead of failing the frame; invalid values remain programmer errors. */
    async pulse(handedness, intensity = 0.5, durationMs = 30) {
        const session = this.#session;
        if (session === undefined)
            throw new Error("Cannot pulse an XR controller before an XR session is active.");
        finite(intensity, "XR haptic intensity");
        if (intensity < 0 || intensity > 1)
            throw new Error("XR haptic intensity must be between 0 and 1.");
        finite(durationMs, "XR haptic duration");
        if (durationMs < 0 || durationMs > 5000)
            throw new Error("XR haptic duration must be between 0 and 5000 milliseconds.");
        let pulsed = false;
        for (const source of session.inputSources) {
            if (source.handedness !== handedness || source.gamepad === undefined)
                continue;
            const actuator = source.gamepad.hapticActuators?.[0];
            if (actuator !== undefined) {
                pulsed = await actuator.pulse(intensity, durationMs) || pulsed;
                continue;
            }
            if (source.gamepad.vibrationActuator !== undefined) {
                await source.gamepad.vibrationActuator.playEffect("dual-rumble", { duration: durationMs, strongMagnitude: intensity, weakMagnitude: intensity });
                pulsed = true;
            }
        }
        return pulsed;
    }
    #onFrame = (time, frame) => {
        const session = this.#session, space = this.#space, callback = this.#callback;
        if (session === undefined || space === undefined || callback === undefined)
            return;
        const viewer = frame.getViewerPose(space);
        if (viewer !== null) {
            this.#presentation?.render(frame, viewer);
            callback(snapshotFrame(time, viewer, session, frame, space));
        }
        if (this.#callback !== undefined)
            this.#frameHandle = session.requestAnimationFrame(this.#onFrame);
    };
    #onEnd = () => { this.#clearSession(); for (const listener of this.#endListeners)
        listener(); };
    #clearSession() { const session = this.#session; if (session !== undefined)
        session.removeEventListener("end", this.#onEnd); this.#presentation?.destroy(); this.#presentation = undefined; this.#session = undefined; this.#space = undefined; this.#mode = undefined; this.#referenceSpaceType = undefined; this.#frameHandle = 0; this.#callback = undefined; }
}
function uniqueSpaces(values) { return [...new Set(values)]; }
async function createGpuPresentation(session, options) {
    if (navigator.gpu === undefined)
        throw new Error("WebXR WebGPU presentation requires navigator.gpu, but WebGPU is unavailable.");
    const Constructor = globalThis.XRGPUBinding;
    if (Constructor === undefined) {
        if (options.fallbackToWebGl === true)
            return createWebGlCompatibilityPresentation(session, options);
        throw new Error("WebXR session started, but XRGPUBinding is unavailable. In Meta Browser enable the experimental WebXR/WebGPU Binding and WebXR Projection Layers features, restart the browser, or enable Vapour's XR-only compatibility presenter.");
    }
    const scaleFactor = options.scaleFactor ?? 1;
    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0 || scaleFactor > 2)
        throw new Error("XR WebGPU projection scaleFactor must be greater than 0 and at most 2.");
    const clearColor = options.clearColor ?? [0.025, 0.055, 0.08, 1];
    if (clearColor.length !== 4 || clearColor.some(value => !Number.isFinite(value)))
        throw new Error("XR WebGPU clearColor requires four finite values.");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance", xrCompatible: true });
    if (adapter === null)
        throw new Error("WebXR requested an XR-compatible WebGPU adapter, but Meta Browser returned none. Confirm the WebXR/WebGPU Binding experiment is enabled and hardware acceleration is active.");
    const device = await adapter.requestDevice();
    const binding = new Constructor(session, device);
    const format = binding.getPreferredColorFormat();
    const init = { colorFormat: format, depthStencilFormat: "depth24plus" };
    if (scaleFactor !== 1)
        init.scaleFactor = scaleFactor;
    const layer = binding.createProjectionLayer(init);
    if (session.updateRenderState === undefined)
        throw new Error("WebXR session does not expose updateRenderState required for WebGPU projection layers.");
    session.updateRenderState({ layers: [layer] });
    return {
        render(_frame, viewer) {
            const encoder = device.createCommandEncoder({ label: "Vapour XR compositor clear" });
            for (const view of viewer.views) {
                const image = binding.getViewSubImage(layer, view);
                const pass = encoder.beginRenderPass({ colorAttachments: [{ view: image.colorTexture.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: clearColor[0], g: clearColor[1], b: clearColor[2], a: clearColor[3] } }], ...(image.depthStencilTexture === undefined ? {} : { depthStencilAttachment: { view: image.depthStencilTexture.createView(), depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1 } }) });
                pass.end();
            }
            device.queue.submit([encoder.finish()]);
        },
        destroy() { device.destroy(); },
    };
}
async function createWebGlCompatibilityPresentation(session, options) {
    const Constructor = globalThis.XRWebGLLayer;
    if (Constructor === undefined)
        throw new Error("Quest rejected WebXR/WebGPU and XRWebGLLayer is also unavailable, so no immersive presentation backend can be created.");
    if (session.updateRenderState === undefined)
        throw new Error("WebXR compatibility presentation requires session.updateRenderState().");
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { xrCompatible: true, alpha: false, antialias: true });
    if (gl === null)
        throw new Error("Quest rejected WebXR/WebGPU and Vapour could not create the XR-only WebGL2 compatibility context.");
    const compatible = gl;
    await compatible.makeXRCompatible?.();
    const scale = options.scaleFactor ?? 1;
    const layer = new Constructor(session, gl, scale === 1 ? undefined : { framebufferScaleFactor: scale });
    session.updateRenderState({ baseLayer: layer });
    const color = options.clearColor ?? [0.025, 0.055, 0.08, 1];
    const mirror = options.compatibilitySourceCanvas === undefined ? undefined : createCanvasMirror(gl, options.compatibilitySourceCanvas);
    return { render(_frame, viewer) { gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer); gl.enable(gl.SCISSOR_TEST); for (const view of viewer.views) {
            const viewport = layer.getViewport(view);
            if (viewport === null)
                continue;
            gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
            gl.scissor(viewport.x, viewport.y, viewport.width, viewport.height);
            gl.clearColor(color[0], color[1], color[2], color[3]);
            gl.clearDepth(1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            mirror?.draw();
        } gl.disable(gl.SCISSOR_TEST); gl.flush(); }, destroy() { mirror?.destroy(); const lose = gl.getExtension("WEBGL_lose_context"); lose?.loseContext(); } };
}
function createCanvasMirror(gl, source) {
    const vertex = compileGlShader(gl, gl.VERTEX_SHADER, `#version 300 es
in vec2 p; out vec2 uv; void main(){uv=vec2((p.x+1.0)*0.5,1.0-(p.y+1.0)*0.5);gl_Position=vec4(p,0.0,1.0);}`);
    const fragment = compileGlShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
precision mediump float; uniform sampler2D image; in vec2 uv; out vec4 color; void main(){color=texture(image,uv);}`);
    const program = gl.createProgram();
    if (program === null)
        throw new Error("XR compatibility presenter could not create its canvas-mirror program.");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(`XR compatibility canvas-mirror link failed: ${gl.getProgramInfoLog(program) ?? "unknown error"}.`);
    const buffer = gl.createBuffer();
    const texture = gl.createTexture();
    const vao = gl.createVertexArray();
    if (buffer === null || texture === null || vao === null)
        throw new Error("XR compatibility presenter could not allocate canvas-mirror GPU resources.");
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { draw() { gl.useProgram(program); gl.bindVertexArray(vao); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        }
        catch (error) {
            throw new Error(`XR compatibility presenter could not copy Vapour's WebGPU canvas: ${error instanceof Error ? error.message : String(error)}.`, { cause: error });
        } gl.drawArrays(gl.TRIANGLES, 0, 3); }, destroy() { gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteVertexArray(vao); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment); } };
}
function compileGlShader(gl, kind, source) { const shader = gl.createShader(kind); if (shader === null)
    throw new Error("XR compatibility presenter could not allocate a shader."); gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error(`XR compatibility shader compilation failed: ${gl.getShaderInfoLog(shader) ?? "unknown error"}.`); return shader; }
function snapshotFrame(time, viewer, session, frame, space) {
    const views = viewer.views.map((view) => Object.freeze({ eye: view.eye, transform: matrix(view.transform.matrix, `XR ${view.eye} view transform`), projection: matrix(view.projectionMatrix, `XR ${view.eye} projection`) }));
    if (views.length === 0)
        throw new Error("WebXR frame reported no views.");
    const inputs = session.inputSources.map((source) => snapshotInput(source, frame, space));
    return Object.freeze({ time, viewerTransform: matrix(viewer.transform.matrix, "XR viewer transform"), views: Object.freeze(views), inputs: Object.freeze(inputs), visibilityState: session.visibilityState ?? "visible" });
}
function snapshotInput(source, frame, space) {
    const target = frame.getPose(source.targetRaySpace, space), grip = source.gripSpace === undefined ? null : frame.getPose(source.gripSpace, space);
    const buttons = source.gamepad?.buttons.map((button) => Object.freeze({ value: finite(button.value, "XR button value"), pressed: button.pressed, touched: button.touched })) ?? [];
    const axes = Float32Array.from(source.gamepad?.axes ?? [], (value) => finite(value, "XR axis value"));
    const joints = [];
    if (source.hand !== undefined && frame.getJointPose !== undefined)
        for (const [name, joint] of source.hand) {
            const pose = frame.getJointPose(joint, space);
            if (pose !== null)
                joints.push(Object.freeze({ name, transform: matrix(pose.transform.matrix, `XR hand joint '${name}'`), radius: pose.radius === undefined ? undefined : finite(pose.radius, `XR hand joint '${name}' radius`) }));
        }
    return Object.freeze({ handedness: source.handedness, targetRayMode: source.targetRayMode, profiles: Object.freeze([...(source.profiles ?? [])]), targetRayTransform: target === null ? undefined : matrix(target.transform.matrix, "XR target ray transform"), gripTransform: grip === null ? undefined : matrix(grip.transform.matrix, "XR grip transform"), buttons: Object.freeze(buttons), axes, joints: Object.freeze(joints) });
}
function matrix(values, label) { if (values.length !== 16)
    throw new Error(`${label} requires 16 matrix values; received ${String(values.length)}.`); const result = Float32Array.from(values); for (const value of result)
    finite(value, label); return result; }
function finite(value, label) { if (!Number.isFinite(value))
    throw new Error(`${label} must be finite.`); return value; }
//# sourceMappingURL=xr.js.map