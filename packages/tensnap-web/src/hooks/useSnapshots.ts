import { useCallback, useEffect } from 'react';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { useSimulationStore } from '../store/simulation';
import { Snapshot } from '../types';

interface SnapshotDB extends DBSchema {
  snapshots: {
    key: string;
    value: Snapshot;
    indexes: { 'by-timestamp': number; 'by-timestep': number };
  };
}

export function useSnapshots() {
  const { snapshots, addSnapshot, clearSnapshots } = useSimulationStore();
  let db: IDBPDatabase<SnapshotDB> | null = null;
  
  useEffect(() => {
    const initDB = async () => {
      db = await openDB<SnapshotDB>('tensnap-snapshots', 1, {
        upgrade(db) {
          const store = db.createObjectStore('snapshots', { keyPath: 'id' });
          store.createIndex('by-timestamp', 'timestamp');
          store.createIndex('by-timestep', 'timeStep');
        },
      });
    };
    
    initDB();
    
    return () => {
      db?.close();
    };
  }, []);
  
  const saveSnapshot = useCallback(async (snapshot: Snapshot) => {
    if (!db) return;
    
    try {
      await db.put('snapshots', snapshot);
      addSnapshot(snapshot);
    } catch (error) {
      console.error('Error saving snapshot:', error);
    }
  }, [addSnapshot]);
  
  const loadSnapshots = useCallback(async () => {
    if (!db) return;
    
    try {
      const allSnapshots = await db.getAll('snapshots');
      clearSnapshots();
      allSnapshots.forEach(addSnapshot);
    } catch (error) {
      console.error('Error loading snapshots:', error);
    }
  }, [addSnapshot, clearSnapshots]);
  
  const deleteSnapshot = useCallback(async (id: string) => {
    if (!db) return;
    
    try {
      await db.delete('snapshots', id);
      // Update store
      const newSnapshots = snapshots.filter(s => s.id !== id);
      clearSnapshots();
      newSnapshots.forEach(addSnapshot);
    } catch (error) {
      console.error('Error deleting snapshot:', error);
    }
  }, [snapshots, addSnapshot, clearSnapshots]);
  
  const exportSnapshots = useCallback(async () => {
    const data = JSON.stringify(snapshots, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snapshots-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [snapshots]);
  
  const importSnapshots = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const imported = JSON.parse(text) as Snapshot[];
      
      clearSnapshots();
      for (const snapshot of imported) {
        await saveSnapshot(snapshot);
      }
    } catch (error) {
      console.error('Error importing snapshots:', error);
    }
  }, [clearSnapshots, saveSnapshot]);
  
  return {
    snapshots,
    saveSnapshot,
    loadSnapshots,
    deleteSnapshot,
    exportSnapshots,
    importSnapshots,
  };
}