import { generateBackroomsColumn, generateBedWarsColumn, generateCastleSiegeColumn, generateCbgoMenuColumn, generateCsgoColumn, generateSkyWarsColumn, generateSurvivalGamesArenaColumn, generateSurvivalGamesOverlay, generateTf2Column, generateTf2TestColumn, generateVoidDuelsColumn } from './CrownForgeArenaMaps';
import { generateLobbyColumn, generatePregameLobbyColumn } from './CrownForgeLobby';
import { writeSafe } from './CrownForgeLevelPrimitives';

export function generateCrownForgeColumn(
  dimension: string,
  data: Uint16Array,
  gx: number,
  lx: number,
  gz: number,
  lz: number,
  startY: number
): boolean {
  const write = writeSafe(data);

  switch (dimension) {
    case 'lobby':
      generateLobbyColumn(write, gx, lx, gz, lz, startY);
      return true;
    case 'skywars':
      generateSkyWarsColumn(write, gx, lx, gz, lz, startY);
      generatePregameLobbyColumn(write, gx, lx, gz, lz, startY);
      return true;
    case 'bedwars':
      generateBedWarsColumn(write, gx, lx, gz, lz, startY);
      generatePregameLobbyColumn(write, gx, lx, gz, lz, startY);
      return true;
    case 'void_duels':
      generateVoidDuelsColumn(write, gx, lx, gz, lz, startY);
      generatePregameLobbyColumn(write, gx, lx, gz, lz, startY);
      return true;
    case 'castle_siege':
      generateCastleSiegeColumn(write, gx, lx, gz, lz, startY);
      generatePregameLobbyColumn(write, gx, lx, gz, lz, startY);
      return true;
    case 'survival_games':
      generateSurvivalGamesArenaColumn(write, gx, lx, gz, lz, startY);
      generatePregameLobbyColumn(write, gx, lx, gz, lz, startY);
      return true;
    case 'backrooms':
      generateBackroomsColumn(write, gx, lx, gz, lz, startY);
      return true;
    case 'cbgo_menu':
      generateCbgoMenuColumn(write, gx, lx, gz, lz, startY);
      generatePregameLobbyColumn(write, gx, lx, gz, lz, startY);
      return true;
    case 'cob_lobby':
      generatePregameLobbyColumn(write, gx, lx, gz, lz, startY);
      return true;
    case 'cob_crossfire_blocks':
      generateCsgoColumn(write, gx, lx, gz, lz, startY, 'overpass');
      return true;
    case 'cob_frostline_airbase':
      generateTf2Column(write, gx, lx, gz, lz, startY, 'ctf');
      return true;
    case 'cbgo_mirage':
    case 'cbgo_dust':
      generateCsgoColumn(write, gx, lx, gz, lz, startY, 'mirage');
      return true;
    case 'cbgo_inferno':
      generateCsgoColumn(write, gx, lx, gz, lz, startY, 'inferno');
      return true;
    case 'cbgo_nuke':
    case 'cbgo_train':
      generateCsgoColumn(write, gx, lx, gz, lz, startY, 'nuke');
      return true;
    case 'cbgo_overpass':
      generateCsgoColumn(write, gx, lx, gz, lz, startY, 'overpass');
      return true;
    case 'cbgo_ancient':
      generateCsgoColumn(write, gx, lx, gz, lz, startY, 'ancient');
      return true;
    case 'cbgo_anubis':
    case 'cbgo_cache':
      generateCsgoColumn(write, gx, lx, gz, lz, startY, 'anubis');
      return true;
    case 'cbgo_vertigo':
      generateCsgoColumn(write, gx, lx, gz, lz, startY, 'vertigo');
      return true;
    case 'tf2_payload':
      generateTf2Column(write, gx, lx, gz, lz, startY, 'payload');
      generatePregameLobbyColumn(write, gx, lx, gz, lz, startY);
      return true;
    case 'tf2_cp':
      generateTf2Column(write, gx, lx, gz, lz, startY, 'cp');
      generatePregameLobbyColumn(write, gx, lx, gz, lz, startY);
      return true;
    case 'tf2_koth':
      generateTf2Column(write, gx, lx, gz, lz, startY, 'koth');
      generatePregameLobbyColumn(write, gx, lx, gz, lz, startY);
      return true;
    case 'tf2_ctf':
      generateTf2Column(write, gx, lx, gz, lz, startY, 'ctf');
      generatePregameLobbyColumn(write, gx, lx, gz, lz, startY);
      return true;
    case 'tf2_test':
      generateTf2TestColumn(write, gx, lx, gz, lz, startY);
      return true;
    default:
      return false;
  }
}

export function generateCrownForgeSurvivalGamesOverlay(
  data: Uint16Array,
  gx: number,
  lx: number,
  gz: number,
  lz: number,
  startY: number
): void {
  const write = writeSafe(data);
  generateSurvivalGamesOverlay(write, gx, lx, gz, lz, startY);
  generatePregameLobbyColumn(write, gx, lx, gz, lz, startY);
}
