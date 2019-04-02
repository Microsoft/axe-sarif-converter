import * as Axe from 'axe-core';
import { SarifConverter } from './sarif-converter';
import { wcagLinkData } from './wcag';
import { ResultDecorator } from './result-decorator';
import { rulesWCAGConfiguration } from './wcag-mappings';
import { DocumentUtils } from './document-utils';
import { MessageDecorator } from './message-decorator';
import { configuration } from './custom-rule-configurations';
import { CheckMessageTransformer } from './check-message-transformer';
import { HelpUrlGetter } from './help-url-getter';
import { ISarifLog } from './sarif/isarflog';

export function axeToSarif(axeResults: Axe.AxeResults): ISarifLog {
    const messageDecorator = new MessageDecorator(
        configuration,
        new CheckMessageTransformer(),
    );

    const chiselHelpUrlGetter = new HelpUrlGetter(configuration);
    const resultDecorator = new ResultDecorator(
        new DocumentUtils(),
        messageDecorator,
        ruleId => chiselHelpUrlGetter.getHelpUrl(ruleId),
    );

    resultDecorator.setWCAGConfiguration(rulesWCAGConfiguration);

    const sarifConverter = new SarifConverter(wcagLinkData);

    // AxeResults -> IChiselResults
    const chiselResults = resultDecorator.decorateResults(axeResults);

    // IChiselResults -> ISarifLog
    return sarifConverter.convert(chiselResults, {}); // TODO - IChiselOptions w/ scanName, testCaseId, scanId
}
