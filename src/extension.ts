import { pid } from 'process';
import { gt as semver_gt } from 'semver';
import { commands, env, ExtensionContext, extensions, languages, Memento, window } from 'vscode';

import { installedEvent, launchedEvent, upgradedEvent } from './analytics';
import { DetailedSiteInfo, ProductBitbucket, ProductJira } from './atlclients/authInfo';
import { startListening } from './atlclients/negotiate';
import { BitbucketContext } from './bitbucket/bbContext';
import { activate as activateCodebucket } from './codebucket/command/registerCommands';
import { CommandContext, setCommandContext } from './commandContext';
import { registerCommands, registerRovoDevCommands } from './commands';
import { Configuration } from './config/configuration';
import { Commands, ExtensionId, GlobalStateVersionKey } from './constants';
import { Container } from './container';
import { registerAnalyticsClient, registerErrorReporting, unregisterErrorReporting } from './errorReporting';
import { provideCodeLenses } from './jira/todoObserver';
import { Logger } from './logger';
import { PipelinesYamlCompletionProvider } from './pipelines/yaml/pipelinesYamlCompletionProvider';
import {
    activateYamlExtension,
    addPipelinesSchemaToYamlConfig,
    BB_PIPELINES_FILENAME,
} from './pipelines/yaml/pipelinesYamlHelper';
import { registerResources } from './resources';
import { deactivateRovoDevProcessManager, initializeRovoDevProcessManager } from './rovo-dev/rovoDevProcessManager';
import { GitExtension } from './typings/git';
import { Experiments, FeatureFlagClient, Features } from './util/featureFlags';
import { NotificationManagerImpl } from './views/notifications/notificationManager';

const AnalyticDelay = 5000;

export async function activate(context: ExtensionContext) {
    const start = process.hrtime();

    registerErrorReporting();

    const atlascode = extensions.getExtension(ExtensionId)!;
    const atlascodeVersion = atlascode.packageJSON.version;
    const previousVersion = context.globalState.get<string>(GlobalStateVersionKey);

    registerResources(context);

    Configuration.configure(context);
    Logger.configure(context);

    // this disables the main Atlassian activity bar when we are in BBY
    setCommandContext(CommandContext.BbyEnvironmentActive, !!process.env.ROVODEV_BBY);
    // this disables the Rovo Dev activity bar unless it's explicitely enabled
    setCommandContext(CommandContext.RovoDevEnabled, !!process.env.ROVODEV_ENABLED);

    // Mark ourselves as the PID in charge of refreshing credentials and start listening for pings.
    context.globalState.update('rulingPid', pid);

    try {
        await Container.initialize(context, atlascodeVersion);

        activateErrorReporting();
        registerRovoDevCommands(context);

        if (!process.env.ROVODEV_BBY) {
            registerCommands(context);
            activateCodebucket(context);

            setCommandContext(
                CommandContext.IsJiraAuthenticated,
                Container.siteManager.productHasAtLeastOneSite(ProductJira),
            );
            setCommandContext(
                CommandContext.IsBBAuthenticated,
                Container.siteManager.productHasAtLeastOneSite(ProductBitbucket),
            );

            NotificationManagerImpl.getInstance().listen();
        }
    } catch (e) {
        Logger.error(e, 'Error initializing atlascode!');
    }

    startListening((site: DetailedSiteInfo) => {
        Container.clientManager.requestSite(site);
    });

    if (!process.env.ROVODEV_BBY) {
        // new user for auth exp
        if (previousVersion === undefined) {
            const expVal = FeatureFlagClient.checkExperimentValue(Experiments.AtlascodeOnboardingExperiment);
            if (expVal) {
                commands.executeCommand(Commands.ShowOnboardingFlow);
            } else {
                commands.executeCommand(Commands.ShowOnboardingPage);
            }
        } else {
            showWelcomePage(atlascodeVersion, previousVersion);
        }
    }

    const delay = Math.floor(Math.random() * Math.floor(AnalyticDelay));
    setTimeout(() => {
        sendAnalytics(atlascodeVersion, context.globalState);
    }, delay);

    if (!process.env.ROVODEV_BBY) {
        context.subscriptions.push(languages.registerCodeLensProvider({ scheme: 'file' }, { provideCodeLenses }));

        // Following are async functions called without await so that they are run
        // in the background and do not slow down the time taken for the extension
        // icon to appear in the activity bar
        activateBitbucketFeatures();
        activateYamlFeatures(context);
    }

    if (!!process.env.ROVODEV_ENABLED) {
        initializeRovoDevProcessManager(context);

        if (process.env.ROVODEV_BBY) {
            commands.executeCommand('workbench.view.extension.atlascode-rovo-dev');
        }
    }

    const duration = process.hrtime(start);

    Logger.info(
        `Atlassian for VS Code (v${atlascodeVersion}) activated in ${
            duration[0] * 1000 + Math.floor(duration[1] / 1000000)
        } ms`,
    );
}

function activateErrorReporting(): void {
    if (Container.isDebugging || FeatureFlagClient.checkGate(Features.EnableErrorTelemetry)) {
        registerAnalyticsClient(Container.analyticsClient);
    } else {
        unregisterErrorReporting();
    }
}

async function activateBitbucketFeatures() {
    let gitExt: GitExtension;
    try {
        const gitExtension = extensions.getExtension<GitExtension>('vscode.git');
        if (!gitExtension) {
            throw new Error('vscode.git extension not found');
        }
        gitExt = await gitExtension.activate();
    } catch (e) {
        Logger.error(e, 'Error activating vscode.git extension');
        window.showWarningMessage(
            'Activating Bitbucket features failed. There was an issue activating vscode.git extension.',
        );
        return;
    }

    try {
        const gitApi = gitExt.getAPI(1);
        const bbContext = new BitbucketContext(gitApi);
        Container.initializeBitbucket(bbContext);
    } catch (e) {
        Logger.error(e, 'Activating Bitbucket features failed');
        window.showWarningMessage('Activating Bitbucket features failed');
    }
}

async function activateYamlFeatures(context: ExtensionContext) {
    context.subscriptions.push(
        languages.registerCompletionItemProvider(
            { scheme: 'file', language: 'yaml', pattern: `**/*${BB_PIPELINES_FILENAME}` },
            new PipelinesYamlCompletionProvider(),
        ),
    );
    await addPipelinesSchemaToYamlConfig();
    await activateYamlExtension();
}

async function showWelcomePage(version: string, previousVersion: string | undefined) {
    if (
        (previousVersion === undefined || semver_gt(version, previousVersion)) &&
        Container.config.showWelcomeOnInstall &&
        window.state.focused
    ) {
        window
            .showInformationMessage(`Jira and Bitbucket (Official) has been updated to v${version}`, 'Release notes')
            .then((userChoice) => {
                if (userChoice === 'Release notes') {
                    commands.executeCommand('extension.open', ExtensionId, 'changelog');
                }
            });
    }
}

async function sendAnalytics(version: string, globalState: Memento) {
    const previousVersion = globalState.get<string>(GlobalStateVersionKey);
    globalState.update(GlobalStateVersionKey, version);

    if (previousVersion === undefined) {
        installedEvent(version).then((e) => {
            Container.analyticsClient.sendTrackEvent(e);
        });
        return;
    }

    if (semver_gt(version, previousVersion)) {
        Logger.info(`Atlassian for VS Code upgraded from v${previousVersion} to v${version}`);
        upgradedEvent(version, previousVersion).then((e) => {
            Container.analyticsClient.sendTrackEvent(e);
        });
    }

    launchedEvent(
        env.remoteName ? env.remoteName : 'local',
        env.uriScheme,
        Container.siteManager.numberOfAuthedSites(ProductJira, true),
        Container.siteManager.numberOfAuthedSites(ProductJira, false),
        Container.siteManager.numberOfAuthedSites(ProductBitbucket, true),
        Container.siteManager.numberOfAuthedSites(ProductBitbucket, false),
    ).then((e) => {
        Container.analyticsClient.sendTrackEvent(e);
    });
}

// this method is called when your extension is deactivated
export function deactivate() {
    if (!!process.env.ROVODEV_ENABLED) {
        deactivateRovoDevProcessManager();
    }

    unregisterErrorReporting();
    FeatureFlagClient.dispose();
    NotificationManagerImpl.getInstance().stopListening();
}
