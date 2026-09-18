import { type SceneData } from "../core/scene-document.js";
export type TemplateId = "empty-3d" | "empty-2d" | "webxr";
export interface ProjectTemplate {
    readonly id: TemplateId;
    readonly label: string;
    readonly description: string;
    readonly sceneName: string;
    /** Builds the starter scene. Fresh UUIDs each call so two projects made from
     * the same template never share entity identities. */
    buildScene(): SceneData;
    /** Gameplay entry point written to `Scripts/main.ts`. */
    script(): string;
}
/**
 * Starter content for new projects.
 *
 * The Hub, the CLI's `create` command, and the checked-in `templates/`
 * directory all build from these definitions, so a project created in the
 * browser and one created from a terminal are identical. Templates use ordinary
 * engine APIs — components, transforms, scripts — rather than hidden engine
 * behaviour, which is also what makes them useful as worked examples.
 */
export declare function projectTemplates(): readonly ProjectTemplate[];
export declare function projectTemplate(id: string): ProjectTemplate;
/** Serializes a scene the same way the editor does, so template output and
 * editor saves produce byte-identical, diff-friendly files. */
export declare function serializeScene(scene: SceneData): string;
//# sourceMappingURL=project-templates.d.ts.map