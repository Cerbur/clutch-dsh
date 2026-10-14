import { useRef, useState } from 'react';
import type { BranchRecord } from '../../../contract/index.js';
import {
  createWorktreeModalViewLoader,
  createWorktreeRefreshGuard,
  type WorktreeViewError,
  type WorktreeWorkspaceView,
} from '../../view/worktree-view.js';
import type {
  ImportCandidatesState,
  WorktreeRegistrationMode,
  WorktreeSurfaceProps,
} from '../types.js';

type Input = { props: Pick<WorktreeSurfaceProps, 'viewReader' | 'manager'> };

export function useRegistrationState({ props }: Input) {
  const { viewReader } = props;
  const [worktreeModalWorkspaceId, setWorktreeModalWorkspaceId] = useState<string>();
  const [modalReadError, setModalReadError] = useState<WorktreeViewError>();
  const [modalReadLoading, setModalReadLoading] = useState(false);
  const [modalBranches, setModalBranches] = useState<readonly BranchRecord[]>();
  const [worktreeModalMode, setWorktreeModalMode] = useState<WorktreeRegistrationMode>('create');
  const [importCandidates, setImportCandidates] = useState<ImportCandidatesState>({
    status: 'idle',
    candidates: [],
  });
  const [selectedImportPath, setSelectedImportPath] = useState<string | undefined>();
  const [selectedBranch, setSelectedBranch] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const modalReadLoader = useRef(createWorktreeModalViewLoader(viewReader));
  const modalReadViewRef = useRef<WorktreeWorkspaceView>();
  const importCandidatesGuard = useRef(createWorktreeRefreshGuard());
  const modalWorkspaceIdRef = useRef(worktreeModalWorkspaceId);
  const modalGenerationRef = useRef(0);
  const modalLifetimeRef = useRef(0);
  modalWorkspaceIdRef.current = worktreeModalWorkspaceId;
  return {
    worktreeModalWorkspaceId,
    setWorktreeModalWorkspaceId,
    modalReadError,
    setModalReadError,
    modalReadLoading,
    setModalReadLoading,
    modalBranches,
    setModalBranches,
    worktreeModalMode,
    setWorktreeModalMode,
    importCandidates,
    setImportCandidates,
    selectedImportPath,
    setSelectedImportPath,
    selectedBranch,
    setSelectedBranch,
    newBranch,
    setNewBranch,
    modalReadLoader,
    modalReadViewRef,
    importCandidatesGuard,
    modalWorkspaceIdRef,
    modalGenerationRef,
    modalLifetimeRef,
  };
}
