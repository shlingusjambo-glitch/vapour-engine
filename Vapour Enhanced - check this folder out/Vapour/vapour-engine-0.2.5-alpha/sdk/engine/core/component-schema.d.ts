import type { ComponentRecord } from "./scene-document.js";
/** Declarative description of one editable component field.
 *
 * Schemas are the single source of truth shared by the inspector UI, the
 * Add Component menu, primitive creation, and serialization defaults, so a
 * component gains editor tooling by being described rather than by hand-written
 * panel code. Plugins register their own schemas through the same registry.
 *
 * Every field must map to data a runtime system actually consumes; Vapour does
 * not ship inspector controls that write values nothing reads.
 */
export type FieldSchema = {
    readonly kind: "number";
    readonly key: string;
    readonly label: string;
    readonly default: number;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
} | {
    readonly kind: "text";
    readonly key: string;
    readonly label: string;
    readonly default: string;
    readonly placeholder?: string;
} | {
    readonly kind: "vector2";
    readonly key: string;
    readonly label: string;
    readonly default: readonly [number, number];
    readonly step?: number;
} | {
    readonly kind: "vector3";
    readonly key: string;
    readonly label: string;
    readonly default: readonly [number, number, number];
    readonly step?: number;
} | {
    readonly kind: "color";
    readonly key: string;
    readonly label: string;
    readonly default: readonly [number, number, number];
} | {
    readonly kind: "colorAlpha";
    readonly key: string;
    readonly label: string;
    readonly default: readonly [number, number, number, number];
} | {
    readonly kind: "boolean";
    readonly key: string;
    readonly label: string;
    readonly default: boolean;
} | {
    readonly kind: "enum";
    readonly key: string;
    readonly label: string;
    readonly default: string;
    readonly options: readonly EnumOption[];
};
export interface EnumOption {
    readonly value: string;
    readonly label: string;
}
export interface ComponentSchema {
    readonly typeName: string;
    readonly label: string;
    /** Short text glyph used by the hierarchy, inspector, and menus. */
    readonly icon: string;
    readonly version: number;
    readonly summary: string;
    /** Transform-like components that every entity must keep are not removable. */
    readonly removable: boolean;
    readonly fields: readonly FieldSchema[];
}
export type ComponentData = Record<string, unknown>;
/** Builds a fully populated component payload from a schema's defaults. */
export declare function createComponentData(schema: ComponentSchema): ComponentData;
export declare function createComponentRecord(schema: ComponentSchema): ComponentRecord;
/**
 * Normalizes stored component data against its schema.
 *
 * Missing fields fall back to schema defaults so older scenes keep loading, but
 * a field that is present with the wrong shape is an authoring error and throws
 * with the component and field named. Unknown keys are preserved untouched so a
 * scene authored with a plugin installed survives a round trip without it.
 */
export declare function normalizeComponentData(schema: ComponentSchema, data: unknown): ComponentData;
/** Applies one edited field, returning new data without mutating the input. */
export declare function setComponentField(schema: ComponentSchema, data: unknown, key: string, value: unknown): ComponentData;
/** Registry of authorable component schemas. The editor owns one instance and
 * plugins extend it; lookups are by stable `typeName`. */
export declare class ComponentSchemaRegistry {
    #private;
    constructor(schemas?: readonly ComponentSchema[]);
    register(schema: ComponentSchema): void;
    get(typeName: string): ComponentSchema | undefined;
    require(typeName: string): ComponentSchema;
    /** Addable components, alphabetical, optionally filtered by a menu query. */
    list(query?: string): readonly ComponentSchema[];
}
export declare const TRANSFORM_TYPE_NAME = "vapour.Transform";
/** Components implemented end to end by the current runtime. Anything the
 * renderer or a runtime system does not yet consume stays out of this list so
 * the editor never presents a control that changes nothing. */
export declare function builtinComponentSchemas(): readonly ComponentSchema[];
//# sourceMappingURL=component-schema.d.ts.map