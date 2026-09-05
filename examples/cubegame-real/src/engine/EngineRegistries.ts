import { EventBus } from '../core/EventBus';

export interface ModBiomeDefinition {
  id: string;
  name: string;
  temperature?: number;
  humidity?: number;
  fogColor?: number;
  skyColor?: number;
  waterColor?: number;
  grassColor?: number;
  foliageColor?: number;
  surfaceBlock?: number;
  subsurfaceBlock?: number;
  bedrockBlock?: number;
  features?: any[];
  structures?: string[];
  spawnRates?: Record<string, number>;
}

export interface ModDimensionDefinition {
  id: string;
  name: string;
  ambientLight?: number;
  hasSkylight?: boolean;
  bedWorks?: boolean;
  generator?: (...args: any[]) => void;
}

export interface ModStructureDefinition {
  id: string;
  name: string;
  minY?: number;
  maxY?: number;
  chance?: number;
  biomes?: string[];
  place: (ctx: any) => void;
}

export type NetworkHandler = (payload: any, sender?: any) => void;

class Registry<T extends { id: string }> {
  private values = new Map<string, T>();

  public register(value: T): void {
    if (!value?.id) throw new Error('Registry value needs a string id.');
    this.values.set(value.id, value);
  }

  public get(id: string): T | undefined {
    return this.values.get(id);
  }

  public has(id: string): boolean {
    return this.values.has(id);
  }

  public getAll(): T[] {
    return [...this.values.values()];
  }
}

export class BiomeRegistryClass extends Registry<ModBiomeDefinition> {
  public override register(value: ModBiomeDefinition): void {
    super.register(value);
    EventBus.emit('mod:biomeRegistered', value);
  }
}

export class DimensionRegistryClass extends Registry<ModDimensionDefinition> {
  public override register(value: ModDimensionDefinition): void {
    super.register(value);
    EventBus.emit('mod:dimensionRegistered', value);
  }
}

export class StructureRegistryClass extends Registry<ModStructureDefinition> {
  public override register(value: ModStructureDefinition): void {
    super.register(value);
    EventBus.emit('mod:structureRegistered', value);
  }
}

export class NetworkRegistryClass {
  private handlers = new Map<string, Set<NetworkHandler>>();

  public on(channel: string, handler: NetworkHandler): void {
    if (!this.handlers.has(channel)) this.handlers.set(channel, new Set());
    this.handlers.get(channel)!.add(handler);
  }

  public off(channel: string, handler: NetworkHandler): void {
    this.handlers.get(channel)?.delete(handler);
  }

  public emit(channel: string, payload: any): void {
    EventBus.emit('mod:networkSend', { channel, payload });
    const set = this.handlers.get(channel);
    if (!set) return;
    for (const handler of set) handler(payload);
  }

  public receive(channel: string, payload: any, sender?: any): void {
    const set = this.handlers.get(channel);
    if (!set) return;
    for (const handler of set) handler(payload, sender);
  }
}

export const BiomeRegistry = new BiomeRegistryClass();
export const DimensionRegistry = new DimensionRegistryClass();
export const StructureRegistry = new StructureRegistryClass();
export const NetworkRegistry = new NetworkRegistryClass();
