export class SkillPersistenceError extends Error {
  readonly category = 'persistence_failed';
  readonly exitCode = 6;
}
