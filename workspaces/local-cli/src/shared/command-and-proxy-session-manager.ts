import {IOpticTaskRunnerConfig} from '@useoptic/cli-config';
import {ICaptureSaver} from '@useoptic/cli-server';
import {HttpToolkitCapturingProxy} from '@useoptic/proxy';
import {IHttpInteraction} from '@useoptic/proxy';
import {CommandSession} from './command-session';
import {developerDebugLogger, userDebugLogger} from './logger';

class CommandAndProxySessionManager {
  constructor(private config: IOpticTaskRunnerConfig) {

  }

  async run(persistenceManager: ICaptureSaver) {
    const commandSession = new CommandSession();
    const inboundProxy = new HttpToolkitCapturingProxy();
    const servicePort = this.config.serviceConfig.port;
    const serviceHost = this.config.serviceConfig.host;
    const opticServiceConfig = {
      OPTIC_API_PORT: servicePort.toString(),
      OPTIC_API_HOST: serviceHost.toString(),
    };

    await persistenceManager.init(this.config.captureId);

    inboundProxy.events.on('sample', (sample: IHttpInteraction) => {
      userDebugLogger(`got sample ${sample.request.method} ${sample.request.path}`);
      persistenceManager.save(sample);
    });

    const target = require('url')
      .format({
        hostname: serviceHost,
        port: servicePort,
        protocol: this.config.serviceConfig.protocol
      });
    developerDebugLogger({target});
    await inboundProxy.start({
      flags: {
        chrome: process.env.OPTIC_ENABLE_CHROME === 'yes',
        includeTextBody: process.env.OPTIC_ENABLE_CAPTURE_BODY === 'yes',
        includeJsonBody: process.env.OPTIC_ENABLE_CAPTURE_BODY === 'yes',
        includeShapeHash: true
      },
      host: this.config.proxyConfig.host,
      proxyTarget: process.env.OPTIC_ENABLE_TRANSPARENT_PROXY === 'yes' ? undefined : target,
      proxyPort: this.config.proxyConfig.port
    });

    userDebugLogger(`started inbound proxy on port ${this.config.proxyConfig.port}`);
    userDebugLogger(`Your command will be run with environment variable OPTIC_API_PORT=${servicePort}.`);
    userDebugLogger(`All traffic should go through the inbound proxy on port ${this.config.proxyConfig.port} and it will be forwarded to ${this.config.serviceConfig.host}.`);
    const promises = [];
    developerDebugLogger(this.config);
    if (this.config.command) {
      userDebugLogger(`running command ${this.config.command}`);
      await commandSession.start({
        command: this.config.command,
        // @ts-ignore
        environmentVariables: {
          ...process.env,
          ...opticServiceConfig
        }
      });
      const commandStoppedPromise = new Promise(resolve => {
        commandSession.events.on('stopped', ({state}) => {
          developerDebugLogger(`command session stopped (${state})`);
          resolve();
        });
      });
      promises.push(commandStoppedPromise);
    }

    const processInterruptedPromise = new Promise((resolve) => {
      process.on('SIGINT', () => {
        resolve();
      });
    });
    promises.push(processInterruptedPromise);

    developerDebugLogger(`waiting for command to complete or ^C`);
    await Promise.race(promises);
    commandSession.stop();
    await inboundProxy.stop();
  }
}

export {
  CommandAndProxySessionManager
};
