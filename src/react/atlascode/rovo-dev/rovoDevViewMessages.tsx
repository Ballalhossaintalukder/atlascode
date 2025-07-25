import { ReducerAction } from '@atlassianlabs/guipi-core-controller';
import { RovoDevContext, RovoDevPrompt } from 'src/rovo-dev/rovoDevTypes';

export const enum RovoDevViewResponseType {
    Prompt = 'prompt',
    CancelResponse = 'cancelResponse',
    OpenFile = 'openFile',
    UndoFileChanges = 'undoFileChanges',
    KeepFileChanges = 'keepFileChanges',
    GetOriginalText = 'getOriginalText',
    CreatePR = 'createPR',
    CreatePRComplete = 'createPRComplete',
    RetryPromptAfterError = 'retryPromptAfterError',
    GetCurrentBranchName = 'getCurrentBranchName',
    AddContext = 'addContext',
    ForceUserFocusUpdate = 'forceUserFocusUpdate',
    ReportChangedFilesPanelShown = 'reportChangedFilesPanelShown',
    ReportChangesGitPushed = 'reportChangesGitPushed',
}

export type RovoDevViewResponse =
    | ReducerAction<RovoDevViewResponseType.Prompt, RovoDevPrompt>
    | ReducerAction<RovoDevViewResponseType.CancelResponse>
    | ReducerAction<RovoDevViewResponseType.OpenFile, { filePath: string; tryShowDiff: boolean; range?: number[] }>
    | ReducerAction<RovoDevViewResponseType.UndoFileChanges, { filePaths: string[] }>
    | ReducerAction<RovoDevViewResponseType.KeepFileChanges, { filePaths: string[] }>
    | ReducerAction<RovoDevViewResponseType.GetOriginalText, { filePath: string; range?: number[]; requestId: string }>
    | ReducerAction<RovoDevViewResponseType.CreatePR, { payload: { branchName: string; commitMessage: string } }>
    | ReducerAction<RovoDevViewResponseType.CreatePRComplete, { url?: string; error?: string }>
    | ReducerAction<RovoDevViewResponseType.RetryPromptAfterError>
    | ReducerAction<RovoDevViewResponseType.GetCurrentBranchName>
    | ReducerAction<RovoDevViewResponseType.AddContext, { currentContext: RovoDevContext }>
    | ReducerAction<RovoDevViewResponseType.ForceUserFocusUpdate>
    | ReducerAction<RovoDevViewResponseType.ReportChangedFilesPanelShown, { filesCount: number }>
    | ReducerAction<RovoDevViewResponseType.ReportChangesGitPushed, { pullRequestCreated: boolean }>;
