import { CAMERA_STRIDE } from "../core/frame-builder.js";
import { projectionExtent, projectionToWebGpuDepth, } from "./render-layers.js";
/** Asks the binding whether it takes a `texture-array` projection layer.
 * Bindings that do not throw from `createProjectionLayer`. */
export function probeXrPresentation(binding, depthStencilFormat = "depth24plus") {
    const colorFormat = binding.getPreferredColorFormat();
    let multiview = false;
    try {
        binding.createProjectionLayer({ colorFormat, depthStencilFormat, textureType: "texture-array" });
        multiview = true;
    }
    catch {
        multiview = false;
    }
    return { multiview, colorFormat };
}
/** The default copier for a real device: the canvas is the copy source. */
export function canvasSubImageCopier(device, canvas) {
    return ({ subImage, sourceRect, destinationRect, imageIndex }) => {
        device.queue.copyExternalImageToTexture({ source: canvas, origin: { x: sourceRect.x, y: sourceRect.y } }, { texture: subImage.colorTexture, origin: { x: destinationRect.x, y: destinationRect.y, z: imageIndex } }, { width: destinationRect.width, height: destinationRect.height });
    };
}
/**
 * Presents rig frames to a WebXR/WebGPU projection layer through a render
 * host. Create it once per session; call {@link present} every XR frame.
 */
export class XrPresentation {
    mode;
    #host;
    #binding;
    #layer;
    #copy;
    #canvasSize = { width: 0, height: 0 };
    constructor(options) {
        const capabilities = probeXrPresentation(options.binding, options.depthStencilFormat);
        const multiview = (options.multiview ?? true) && capabilities.multiview;
        const init = {
            colorFormat: capabilities.colorFormat,
            depthStencilFormat: options.depthStencilFormat ?? "depth24plus",
            textureType: multiview ? "texture-array" : "texture",
            ...(options.scaleFactor === undefined ? {} : { scaleFactor: options.scaleFactor }),
        };
        if (init.scaleFactor !== undefined && !(init.scaleFactor > 0 && init.scaleFactor <= 2))
            throw new Error("XR projection scaleFactor must be greater than 0 and at most 2.");
        this.mode = multiview ? "multiview" : "two-pass";
        this.#host = options.host;
        this.#binding = options.binding;
        this.#copy = options.copy;
        this.#layer = options.binding.createProjectionLayer(init);
        options.session.updateRenderState({ layers: [this.#layer] });
    }
    /**
     * Renders `frame` once per eye and copies each eye into its sub-image.
     * `views` are the XR frame's views (matched to `rig.eyes` by eye label);
     * `frame` is the scene without a camera, which each eye supplies.
     */
    present(views, rig, frame, timeMilliseconds) {
        if (rig.eyes.length === 0)
            throw new Error("An XR rig frame needs at least one eye to present.");
        const eyes = rig.eyes.map((camera) => {
            const view = views.find((candidate) => candidate.eye === camera.eye);
            if (view === undefined)
                throw new Error(`The XR frame has no '${camera.eye}' view for the rig's eye.`);
            const subImage = this.#binding.getViewSubImage(this.#layer, view);
            const textureRect = subImage.viewport ?? { x: 0, y: 0, width: subImage.colorTexture.width, height: subImage.colorTexture.height };
            if (!(textureRect.width > 0 && textureRect.height > 0))
                throw new Error(`The XR '${camera.eye}' sub-image has an empty viewport.`);
            return { camera, subImage, textureRect, imageIndex: subImage.imageIndex ?? 0 };
        });
        // Eyes sit side by side in the canvas at their compositor sizes, so
        // every copy is pixel for pixel.
        let width = 0;
        let height = 0;
        const canvasRects = eyes.map(({ textureRect }) => {
            const rect = { x: width, y: 0, width: textureRect.width, height: textureRect.height };
            width += textureRect.width;
            height = Math.max(height, textureRect.height);
            return rect;
        });
        if (width !== this.#canvasSize.width || height !== this.#canvasSize.height) {
            this.#canvasSize = { width, height };
            this.#host.setFixedSize?.(width, height);
        }
        const layers = eyes.map(({ camera }, index) => eyeLayer(camera, frame, canvasRects[index], width, height));
        const presented = [];
        const frames = [];
        let submissions = 0;
        const copyEye = (index) => {
            const { camera, subImage, textureRect, imageIndex } = eyes[index];
            this.#copy({ subImage, sourceRect: canvasRects[index], destinationRect: textureRect, imageIndex });
            presented.push({ eye: camera.eye, canvasRect: canvasRects[index], textureRect, imageIndex, camera: layers[index].frame.camera, projection: layers[index].projection });
        };
        if (this.mode === "multiview") {
            this.#host.submitLayers(layers);
            submissions = 1;
            const stats = this.#host.renderFrame(timeMilliseconds);
            if (stats !== undefined)
                frames.push(stats);
            for (let index = 0; index < eyes.length; index += 1)
                copyEye(index);
        }
        else {
            for (let index = 0; index < eyes.length; index += 1) {
                this.#host.submitLayers([layers[index]]);
                submissions += 1;
                const stats = this.#host.renderFrame(timeMilliseconds);
                if (stats !== undefined)
                    frames.push(stats);
                copyEye(index);
            }
        }
        return { mode: this.mode, eyes: presented, submissions, frames, canvasSize: this.#canvasSize };
    }
}
/** One eye as a render layer: the eye's world transform in the camera
 * record with the frustum extent its projection encodes, the projection
 * itself rewritten to WebGPU depth, and the eye's rectangle of the canvas. */
export function eyeLayer(camera, frame, rect, canvasWidth, canvasHeight) {
    const extent = projectionExtent(camera.projection, "negative-one-to-one");
    const record = new Float32Array(CAMERA_STRIDE);
    record.set(camera.world, 0);
    record[16] = 0;
    record[17] = extent.fieldOfViewDegrees;
    record[18] = extent.near;
    record[19] = Number.isFinite(extent.far) ? extent.far : 1e4;
    return {
        frame: { ...frame, camera: record },
        projection: projectionToWebGpuDepth(camera.projection),
        clearColor: true,
        clearDepth: true,
        viewport: { x: rect.x / canvasWidth, y: rect.y / canvasHeight, width: rect.width / canvasWidth, height: rect.height / canvasHeight },
    };
}
//# sourceMappingURL=xr-presentation.js.map