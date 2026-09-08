import { useRef, useState } from 'react';
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

type Input = { props: Pick<WorktreeSurfaceProps, 'viewReader'> };

export function useRegistrationState({ props }: Input) {
  const { viewReader } = props;
  const [worktreeModalWorkspaceId, setWorktreeModalWorkspaceId] = useState<string>();
  const [modalReadError, setModalReadError] = useState<WorktreeViewError>();
  const [modalReadLoading, setModalReadLoading] = useState(false);
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
  modalWorkspaceIdRef.current = worktreeModalWorkspaceId;
  return {
    worktreeModalWorkspaceId,
    setWorktreeModalWorkspaceId,
    modalReadError,
    setModalReadError,
    modalReadLoading,
    setModalReadLoading,
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
  };
}
