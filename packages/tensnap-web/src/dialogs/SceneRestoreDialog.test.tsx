// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import { RendererSession } from '@tensnap/core/runtime';
import { createSingleSnapshot } from '@tensnap/core/snapshot';
import type { ISimulatorTransport, TransportConnectionState, TransportEventHandler, TransportEventMap } from '@tensnap/core';
import type { ProtocolEncoding, RendererToSimulatorMessage } from '@tensnap/protocol';

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@lingui/react', async () => {
  const actual = await vi.importActual<typeof import('@lingui/react')>('@lingui/react');
  return {
    ...actual,
    Trans: ({ children, message, id }: { children?: React.ReactNode; message?: string; id?: string }) => <>{children ?? message ?? id}</>,
    useLingui: () => ({ _: (descriptor: unknown) => typeof descriptor === 'string' ? descriptor : (descriptor as { message?: string; id?: string })?.message ?? (descriptor as { id?: string })?.id ?? '' }),
  };
});

vi.mock('@/store/toast', () => ({ useToast: () => toast }));

import { SceneRestoreDialog } from './SceneRestoreDialog';

i18n.load('en', {});
i18n.activate('en');

function createSynchronousRestoreTransport(session: RendererSession, result: 'ok' | 'error'): ISimulatorTransport {
  return {
    connectionId: 'test://restore',
    transportKind: 'test',
    encoding: 'json' as ProtocolEncoding,
    connectionState: 'open' as TransportConnectionState,
    isConnected: true,
    connect: async () => {},
    disconnect: () => {},
    destroy: () => {},
    on: <K extends keyof TransportEventMap>(type: K, handler: TransportEventHandler<TransportEventMap[K]>) => { void type; void handler; },
    off: <K extends keyof TransportEventMap>(type: K, handler?: TransportEventHandler<TransportEventMap[K]>) => { void type; void handler; },
    send: (message: RendererToSimulatorMessage) => {
      if (message.type !== 'scene_restore') return;
      const payload = message.payload as { request_id: string };
      if (result === 'ok') {
        session.handleIncoming({ type: 'scene_restore_begin', payload: { request_id: payload.request_id } });
        session.handleIncoming({ type: 'scene_restore_end', payload: { request_id: payload.request_id, status: 'ok' } });
        return;
      }
      session.handleIncoming({
        type: 'error',
        payload: { code: 'rejected', message: 'The simulator rejected this restore.', request_id: payload.request_id },
      });
    },
  };
}

function createRestoreSession(result: 'ok' | 'error'): RendererSession {
  const session = new RendererSession();
  session.attachTransport(createSynchronousRestoreTransport(session, result));
  session.handleIncoming({
    type: 'simulator_info',
    payload: {
      protocol_version: '0.3',
      binding: { name: 'dialog-test', version: '0.3.0' },
      model: { id: 'dialog-model' },
      instance_id: 'dialog-instance',
      capabilities: ['scene.restore.projected'],
    },
  });
  return session;
}

const snapshot = createSingleSnapshot({
  metadata: { time: 3 }, actions: [], parameters: [], environments: [], charts: [], monitors: [], logs: [], assets: [],
}, { id: 'dialog-snapshot', modelIdentity: { model_id: 'dialog-model', instance_id: 'dialog-instance' } });

describe('SceneRestoreDialog', () => {
  it('unlocks after a synchronously delivered correlated restore error', async () => {
    const session = createRestoreSession('error');

    render(<SceneRestoreDialog open onOpenChange={vi.fn()} snapshot={snapshot} session={session} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore snapshot' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore snapshot' })).toBeEnabled());
    expect(toast.error).toHaveBeenCalledWith('Snapshot restore failed', 'The simulator rejected this restore.');
  });

  it('closes after a synchronously delivered successful restore', async () => {
    const onOpenChange = vi.fn();
    render(<SceneRestoreDialog open onOpenChange={onOpenChange} snapshot={snapshot} session={createRestoreSession('ok')} />);

    fireEvent.click(screen.getByRole('button', { name: 'Restore snapshot' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('sends only the opaque checkpoint for an exact compatible restore', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport({
      ...createSynchronousRestoreTransport(session, 'ok'),
      send: (message) => sent.push(message),
    });
    session.handleIncoming({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'dialog-test', version: '0.3.0' },
        model: { id: 'dialog-model' },
        instance_id: 'dialog-instance',
        capabilities: ['scene.restore.checkpoint'],
      },
    });
    const checkpointSnapshot = createSingleSnapshot({
      metadata: { time: 3 }, actions: [], parameters: [], environments: [], charts: [], monitors: [], logs: [], assets: [],
    }, {
      id: 'checkpoint-snapshot',
      modelIdentity: { model_id: 'dialog-model', instance_id: 'dialog-instance' },
      checkpoint: { model_id: 'dialog-model', encoding: 'application/octet-stream', data: new Uint8Array([1, 2, 3]) },
    });

    render(<SceneRestoreDialog open onOpenChange={vi.fn()} snapshot={checkpointSnapshot} session={session} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore snapshot' }));

    expect(sent).toContainEqual(expect.objectContaining({
      type: 'scene_restore',
      payload: expect.objectContaining({
        model_id: 'dialog-model',
        checkpoint: { encoding: 'application/octet-stream', data: new Uint8Array([1, 2, 3]) },
      }),
    }));
    const payload = sent.find((message) => message.type === 'scene_restore')!.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('time');
    expect(payload).not.toHaveProperty('parameters');
    expect(payload).not.toHaveProperty('envs');
  });

  it('keeps a mismatched snapshot offline-only', () => {
    const mismatched = createSingleSnapshot({
      metadata: {}, actions: [], parameters: [], environments: [], charts: [], monitors: [], logs: [], assets: [],
    }, { id: 'other-model', modelIdentity: { model_id: 'other-model' } });

    render(<SceneRestoreDialog open onOpenChange={vi.fn()} snapshot={mismatched} session={createRestoreSession('ok')} />);

    expect(screen.getByRole('button', { name: 'Restore snapshot' })).toBeDisabled();
    expect(screen.getByText(/different model or state schema/i)).toBeInTheDocument();
  });
});
