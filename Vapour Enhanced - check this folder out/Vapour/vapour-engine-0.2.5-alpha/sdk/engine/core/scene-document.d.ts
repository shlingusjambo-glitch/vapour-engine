export declare const SCENE_FORMAT_VERSION: 1;
export interface TransformData {
    position: [number, number, number];
    rotation: [number, number, number, number];
    scale: [number, number, number];
}
export interface ComponentRecord {
    typeName: string;
    version: number;
    data: unknown;
}
export interface SceneEntityData {
    id: string;
    name: string;
    parent?: string;
    enabled: boolean;
    components: ComponentRecord[];
}
export interface SceneData {
    formatVersion: typeof SCENE_FORMAT_VERSION;
    id: string;
    name: string;
    entities: SceneEntityData[];
}
export type SceneChange = {
    type: "entity-added";
    id: string;
} | {
    type: "entity-removed";
    id: string;
} | {
    type: "entity-changed";
    id: string;
} | {
    type: "scene-replaced";
};
export declare function defaultTransform(): TransformData;
export declare class SceneDocument extends EventTarget {
    #private;
    constructor(data?: SceneData);
    static empty(name: string): SceneData;
    get data(): Readonly<SceneData>;
    replace(data: SceneData): void;
    entity(id: string): SceneEntityData | undefined;
    addEntity(name?: string, parent?: string): SceneEntityData;
    updateEntity(id: string, update: Partial<Pick<SceneEntityData, "name" | "enabled">>): void;
    setTransform(id: string, transform: TransformData): void;
    addComponent(id: string, component: ComponentRecord): void;
    updateComponentData(id: string, typeName: string, data: unknown): void;
    removeComponent(id: string, typeName: string): void;
    setParent(id: string, parent?: string): void;
    removeEntity(id: string): void;
    duplicateEntity(id: string): SceneEntityData;
    serialize(): string;
}
export declare function validateScene(data: SceneData): void;
//# sourceMappingURL=scene-document.d.ts.map