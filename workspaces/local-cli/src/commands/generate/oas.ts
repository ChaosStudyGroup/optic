import Command, { flags } from '@oclif/command';
import { getPathsRelativeToConfig } from '@useoptic/cli-config';
import { IPathMapping } from '@useoptic/cli-config';
import { OasProjectionHelper } from '@useoptic/domain';
import { cli } from 'cli-ux';
import fs from 'fs-extra';
import path from 'path';
import yaml from 'js-yaml';
import { fromOptic } from '@useoptic/cli-shared';

export default class GenerateOas extends Command {
  static description = 'export an OpenAPI 3.0.1 spec';

  static flags = {
    json: flags.boolean({
      default: true,
      exclusive: ['yaml'],
    }),
    yaml: flags.boolean({
      exclusive: ['json'],
    }),
  };

  async run() {
    try {
      const paths = await getPathsRelativeToConfig();
      const { specStorePath } = paths;
      try {
        const eventsBuffer = await fs.readFile(specStorePath);
        const eventsString = eventsBuffer.toString();
        cli.action.start('Generating OAS file');
        const parsedOas = OasProjectionHelper.fromEventString(eventsString);
        const outputFile = await this.emit(paths, parsedOas);
        cli.action.stop(
          '\n' + fromOptic('Generated OAS file at ' + outputFile)
        );
      } catch (e) {
        this.error(e);
      }
    } catch (e) {
      this.error(e);
    }
  }

  async emit(paths: IPathMapping, parsedOas: object): Promise<string> {
    const { flags } = this.parse(GenerateOas);

    const shouldOutputYaml = flags.yaml;

    const outputPath = path.join(paths.basePath, 'generated');
    await fs.ensureDir(outputPath);
    if (shouldOutputYaml) {
      const outputFile = path.join(outputPath, 'openapi.yaml');
      await fs.writeFile(outputFile, yaml.safeDump(parsedOas, { indent: 1 }));
      return outputFile;
    } else {
      const outputFile = path.join(outputPath, 'openapi.json');
      await fs.writeJson(outputFile, parsedOas, { spaces: 2 });
      return outputFile;
    }
  }
}
