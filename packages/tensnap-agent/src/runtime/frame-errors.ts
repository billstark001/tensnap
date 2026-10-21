import { RenderBatchError, type RenderArtifact } from './painter';

export class FrameSaveError extends Error {
  readonly category: 'persistence_failed' | 'render_failed';
  readonly exitCode: 5 | 6;
  constructor(
    readonly partialDirectory: string,
    readonly artifacts: RenderArtifact[],
    readonly failure: unknown,
  ) {
    super(
      `Frame evidence is incomplete: ${failure instanceof Error ? failure.message : String(failure)}; partial output: ${partialDirectory}`,
    );
    this.category =
      failure instanceof RenderBatchError &&
      failure.errors.every((error) => error.code !== 'persistence_failed')
        ? 'render_failed'
        : 'persistence_failed';
    this.exitCode = this.category === 'render_failed' ? 5 : 6;
  }
}
