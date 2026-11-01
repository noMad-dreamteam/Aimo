import football from './football.js';
import balance from './balance.js';
import squats from './squats.js';
import lunges from './lunges.js';
import pushups from './pushups.js';
import plank from './plank.js';
import jacks from './jacks.js';
import highknees from './highknees.js';
import zolo from './zolo.js';
import trendDance from './trend-dance.js';

// Catalog order: football, strength, cardio, dance. Each entry implements the same skill contract.
export const SKILL_LIST = [football, balance, squats, lunges, pushups, plank, jacks, highknees, zolo, trendDance];
export const SKILLS = Object.fromEntries(SKILL_LIST.map(skill => [skill.id, skill]));
export const getSkill = (id) => Object.hasOwn(SKILLS, id) ? SKILLS[id] : football;
export { PERSONALITIES, DEFAULT_PERSONALITY, personalityId, CATEGORIES } from './common.js';
