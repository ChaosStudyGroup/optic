import { Command } from '@oclif/command';
import { ensureDaemonStarted } from '@useoptic/cli-server';
import path from 'path';
import {
  IApiCliConfig,
  IOpticTaskRunnerConfig,
  IPathMapping,
  TargetPortUnavailableError,
  deprecationLogger,
} from '@useoptic/cli-config';
import { opticTaskToProps, trackUserEvent } from './analytics';
import { lockFilePath } from './paths';
import { Client, SpecServiceClient } from '@useoptic/cli-client';
import findProcess from 'find-process';
import stripAnsi from 'strip-ansi';
// @ts-ignore
import gitRev from 'git-rev-sync';
import {
  ExitedTaskWithLocalCli,
  StartedTaskWithLocalCli,
} from '@useoptic/analytics/lib/events/tasks';

import {
  getCredentials,
  getUserFromCredentials,
} from './authentication-server';
import { runScriptByName } from '@useoptic/cli-scripts';
import {
  cleanupAndExit,
  CommandAndProxySessionManager,
  developerDebugLogger,
  fromOptic,
  IOpticTaskRunner,
  loadPathsAndConfig,
  makeUiBaseUrl,
  warningFromOptic,
} from '@useoptic/cli-shared';
import * as uuid from 'uuid';
//@ts-ignore
import niceTry from 'nice-try';
import { CliTaskSession } from '@useoptic/cli-shared/build/tasks';
import { CaptureSaverWithDiffs } from '@useoptic/cli-shared/build/captures/avro/file-system/capture-saver-with-diffs';
import { EventEmitter } from 'events';
import { Config } from '../config';
import { Debugger } from 'debug';
import { ApiCheckCompleted } from '@useoptic/analytics/lib/events/onboarding';

export async function LocalTaskSessionWrapper(cli: Command, taskName: string) {
  // hijack the config deprecation log to format nicely for the CLI
  deprecationLogger.log = (msg: string) => {
    cli.log(
      warningFromOptic(
        'optic.yml deprecation: ' +
          stripAnsi(msg).replace(deprecationLogger.namespace, '').trim()
      )
    );
  };
  deprecationLogger.enabled = true;

  const { paths, config } = await loadPathsAndConfig(cli);
  const captureId = (() => {
    if (process.env.GITFLOW_CAPTURE) {
      return niceTry(() => gitRev.long(paths.basePath)) || uuid.v4();
    } else {
      return uuid.v4();
    }
  })();
  const runner = new LocalCliTaskRunner(captureId, paths);
  const session = new CliTaskSession(runner);
  await session.start(cli, config, taskName);
  return await cleanupAndExit();
}

export class LocalCliTaskRunner implements IOpticTaskRunner {
  constructor(private captureId: string, private paths: IPathMapping) {}

  async run(
    cli: Command,
    config: IApiCliConfig,
    taskConfig: IOpticTaskRunnerConfig
  ): Promise<void> {
    ////////////////////////////////////////////////////////////////////////////////

    await trackUserEvent(
      StartedTaskWithLocalCli.withProps({
        inputs: opticTaskToProps('', taskConfig),
        cwd: this.paths.cwd,
        captureId: this.captureId,
      })
    );

    ////////////////////////////////////////////////////////////////////////////////

    const blockers = await findProcess('port', taskConfig.proxyConfig.port);
    if (blockers.length > 0) {
      throw new TargetPortUnavailableError(`Optic could not start its proxy server on port ${
        taskConfig.proxyConfig.port
      }.
There is something else running:
${blockers.map((x) => `[pid ${x.pid}]: ${x.cmd}`).join('\n')}
`);
    }

    ////////////////////////////////////////////////////////////////////////////////

    const daemonState = await ensureDaemonStarted(
      lockFilePath,
      Config.apiBaseUrl
    );
    const apiBaseUrl = `http://localhost:${daemonState.port}/api`;
    developerDebugLogger(`api base url: ${apiBaseUrl}`);
    const cliClient = new Client(apiBaseUrl);

    ////////////////////////////////////////////////////////////////////////////////
    developerDebugLogger('checking credentials');
    const credentials = await getCredentials();
    if (credentials) {
      const user = await getUserFromCredentials(credentials);
      await cliClient.setIdentity(user);
    }

    ////////////////////////////////////////////////////////////////////////////////
    developerDebugLogger('finding matching daemon session');

    const { cwd } = this.paths;
    const cliSession = await cliClient.findSession(
      cwd,
      taskConfig,
      this.captureId
    );
    developerDebugLogger({ cliSession });

    ////////////////////////////////////////////////////////////////////////////////

    const uiBaseUrl = makeUiBaseUrl(daemonState);
    const uiUrl = `${uiBaseUrl}/apis/${cliSession.session.id}/diffs`;
    cli.log(fromOptic(`Review the API Diff at ${uiUrl}`));

    ////////////////////////////////////////////////////////////////////////////////
    const { capturesPath } = this.paths;
    const captureId = this.captureId;
    const eventEmitter = new EventEmitter();
    const specServiceClient = new SpecServiceClient(
      cliSession.session.id,
      eventEmitter,
      apiBaseUrl
    );
    const persistenceManager = new CaptureSaverWithDiffs(
      {
        captureBaseDirectory: capturesPath,
        captureId,
      },
      config,
      specServiceClient
    );

    ////////////////////////////////////////////////////////////////////////////////
    process.env.OPTIC_ENABLE_CAPTURE_BODY = 'yes';
    const sessionManager = new CommandAndProxySessionManager(taskConfig);

    await sessionManager.run(persistenceManager);

    ////////////////////////////////////////////////////////////////////////////////
    await cliClient.markCaptureAsCompleted(cliSession.session.id, captureId);
    const summary = await specServiceClient.getCaptureStatus(captureId);
    const sampleCount = summary.interactionsCount;
    const hasDiff = summary.diffsCount > 0;

    trackUserEvent(
      ExitedTaskWithLocalCli.withProps({
        interactionCount: sampleCount,
        inputs: opticTaskToProps('', taskConfig),
        captureId: this.captureId,
      })
    );

    if (hasDiff) {
      const uiUrl = `${uiBaseUrl}/apis/${cliSession.session.id}/diffs/${captureId}`;
      const iconPath = path.join(__dirname, '../../assets/optic-logo-png.png');
      runScriptByName('notify', uiUrl, iconPath);

      cli.log(
        fromOptic(
          `Observed Unexpected API Behavior. Click here to review: ${uiUrl}`
        )
      );
    } else {
      if (sampleCount > 0) {
        cli.log(
          fromOptic(`No API Diff Observed for ${sampleCount} interactions`)
        );
      }
    }
  }
}
