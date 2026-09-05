import { EventBus } from './EventBus';
import { FEATURE_SUMMARY } from '../content/FeatureCatalog';
import { ItemRegistry } from '../items/ItemRegistry';
import { BlockRegistry } from '../world/BlockRegistry';

export class CommandParser {
  public static parse(text: string): boolean {
    if (!text.startsWith('/')) return false;

    const parts = text.slice(1).trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case 'gamemode':
      case 'gm': {
        const mode = args[0]?.toLowerCase();
        if (mode === 'creative' || mode === 'c' || mode === '1') {
          EventBus.emit('command:gamemode', 'creative');
          EventBus.emit('network:chat', '[System] Gamemode set to Creative.');
        } else if (mode === 'survival' || mode === 's' || mode === '0') {
          EventBus.emit('command:gamemode', 'survival');
          EventBus.emit('network:chat', '[System] Gamemode set to Survival.');
        } else if (mode === 'hardcore' || mode === 'h' || mode === '2') {
          EventBus.emit('command:gamemode', 'hardcore');
          EventBus.emit('network:chat', '[System] Gamemode set to Hardcore.');
        } else {
          EventBus.emit('network:chat', '[Error] Usage: /gamemode [survival | creative | hardcore]');
        }
        return true;
      }

      case 'spawn': {
        const type = args[0]?.toLowerCase();
        if (['zombie', 'skeleton', 'creeper', 'spider', 'cow', 'pig', 'sheep', 'enderman', 'villager', 'warden', 'dragon'].includes(type)) {
          EventBus.emit('command:spawn', type);
          EventBus.emit('network:chat', `[System] Spawned ${type}.`);
        } else {
          EventBus.emit('network:chat', '[Error] Usage: /spawn [zombie | skeleton | creeper | spider | cow | pig | sheep | enderman | villager | warden | dragon]');
        }
        return true;
      }

      case 'give': {
        const result = this.resolveGiveArgs(args);
        if (!result) {
          EventBus.emit('network:chat', '[Error] Usage: /give [id or item name] [count]');
          return true;
        }
        EventBus.emit('command:give', result);
        return true;
      }

      case 'features': {
        EventBus.emit(
          'network:chat',
          `[Features] Added ${FEATURE_SUMMARY.totalAdded}: ${FEATURE_SUMMARY.blocks} blocks, ${FEATURE_SUMMARY.items} items, ${FEATURE_SUMMARY.recipes} recipes, ${FEATURE_SUMMARY.smelting} smelting recipes.`
        );
        return true;
      }

      case 'tp':
      case 'teleport': {
        if (args.length >= 3) {
          const x = parseFloat(args[0]);
          const y = parseFloat(args[1]);
          const z = parseFloat(args[2]);
          if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
            EventBus.emit('command:tp', { x, y, z });
            EventBus.emit('network:chat', `[System] Teleported to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
          } else {
            EventBus.emit('network:chat', '[Error] Coordinates must be numbers.');
          }
        } else {
          EventBus.emit('network:chat', '[Error] Usage: /tp [x] [y] [z]');
        }
        return true;
      }

      case 'time': {
        if (args[0] === 'set' && args[1]) {
          const val = parseFloat(args[1]);
          if (!isNaN(val)) {
            EventBus.emit('command:time', val);
            EventBus.emit('network:chat', `[System] Time set to ${val}`);
          } else {
            EventBus.emit('network:chat', '[Error] Time must be a number.');
          }
        } else {
          EventBus.emit('network:chat', '[Error] Usage: /time set [value]');
        }
        return true;
      }

      case 'dimension':
      case 'dim': {
        const dim = args[0]?.toLowerCase();
        if (dim === 'overworld' || dim === 'nether' || dim === 'the_end' || dim === 'backrooms') {
          if (dim === 'backrooms') EventBus.emit('command:backrooms');
          else EventBus.emit('command:dimension', dim);
          EventBus.emit('network:chat', `[System] Teleporting to ${dim}...`);
        } else {
          EventBus.emit('network:chat', '[Error] Usage: /dimension [overworld | nether | the_end | backrooms]');
        }
        return true;
      }

      case 'backrooms': {
        EventBus.emit('command:backrooms');
        return true;
      }

      case 'help': {
        EventBus.emit('network:chat', 'Commands: /gamemode, /give, /features, /spawn, /tp, /time set, /dimension, /backrooms');
        return true;
      }

      default:
        EventBus.emit('network:chat', `[Error] Unknown command: ${command}. Type /help for list of commands.`);
        return true;
    }
  }

  private static resolveGiveArgs(args: string[]): { id: number; count: number; name: string } | null {
    if (args.length === 0) return null;

    const firstAsId = Number(args[0]);
    if (Number.isInteger(firstAsId) && firstAsId > 0) {
      const count = Math.max(1, Math.min(64, Number(args[1]) || 1));
      const item = ItemRegistry.get(firstAsId);
      const name = item ? item.name : BlockRegistry.has(firstAsId) ? BlockRegistry.get(firstAsId).name : `Item #${firstAsId}`;
      return { id: firstAsId, count, name };
    }

    const last = Number(args[args.length - 1]);
    const hasCount = Number.isInteger(last) && last > 0;
    const count = hasCount ? Math.max(1, Math.min(64, last)) : 1;
    const nameQuery = (hasCount ? args.slice(0, -1) : args).join(' ').toLowerCase();
    if (!nameQuery) return null;

    const candidates = [
      ...ItemRegistry.getAll().map((item) => ({ id: item.id, name: item.name })),
      ...BlockRegistry.getAll()
        .filter((block) => block.id !== 0)
        .map((block) => ({ id: block.id, name: block.name })),
    ];

    const exact = candidates.find((candidate) => candidate.name.toLowerCase() === nameQuery);
    const partial = exact ?? candidates.find((candidate) => candidate.name.toLowerCase().includes(nameQuery));
    return partial ? { id: partial.id, count, name: partial.name } : null;
  }
}
