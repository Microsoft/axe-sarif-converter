// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import * as Axe from 'axe-core';
import * as Sarif from 'sarif';
import {
    getArtifactLocation,
    getArtifactProperties,
} from './artifact-property-provider';
import { getAxeToolProperties21 } from './axe-tool-property-provider-21';
import { ConverterOptions } from './converter-options';
import { getConverterProperties } from './converter-property-provider';
import {
    DecoratedAxeResult,
    DecoratedAxeResults,
} from './decorated-axe-results';
import { DictionaryStringTo } from './dictionary-types';
import { EnvironmentData } from './environment-data';
import { getEnvironmentDataFromResults } from './environment-data-provider';
import { getInvocations21 } from './invocation-provider-21';
import { ResultToRuleConverter } from './result-to-rule-converter';
import * as CustomSarif from './sarif/custom-sarif-types-21';
import { isNotEmpty } from './string-utils';
import { axeTagsToWcagLinkData, WCAGLinkData } from './wcag-link-data';
import { WCAGLinkDataIndexer } from './wcag-link-data-indexer';
import { getWcagTaxonomy } from './wcag-taxonomy-provider';

export function defaultSarifConverter21(): SarifConverter21 {
    return new SarifConverter21(
        getConverterProperties,
        getAxeToolProperties21,
        getInvocations21,
        getArtifactProperties,
    );
}
export class SarifConverter21 {
    private readonly tagsToWcagLinkData: DictionaryStringTo<
        WCAGLinkData
    > = axeTagsToWcagLinkData;
    private readonly wcagLinkDataIndexer: WCAGLinkDataIndexer = new WCAGLinkDataIndexer(
        this.tagsToWcagLinkData,
    );

    public constructor(
        private getConverterToolProperties: () => Sarif.Run['conversion'],
        private getAxeProperties: () => Sarif.ToolComponent,
        private invocationConverter: (
            environmentData: EnvironmentData,
        ) => Sarif.Invocation[],
        private getArtifactProperties: (
            environmentData: EnvironmentData,
        ) => Sarif.Artifact,
    ) {}

    public convert(
        results: DecoratedAxeResults,
        options: ConverterOptions,
    ): Sarif.Log {
        return {
            version: CustomSarif.SarifLogVersion21.version,
            runs: [this.convertRun(results, options)],
        };
    }

    private convertRun(
        results: DecoratedAxeResults,
        options: ConverterOptions,
    ): Sarif.Run {
        let properties: DictionaryStringTo<string> = {};

        if (options && options.scanName !== undefined) {
            properties = {
                scanName: options.scanName,
            };
        }

        const resultToRuleConverter: ResultToRuleConverter = new ResultToRuleConverter(
            results,
            this.wcagLinkDataIndexer.getSortedWcagTags(),
            this.wcagLinkDataIndexer.getWcagTagsToTaxaIndices(),
        );

        const run: Sarif.Run = {
            conversion: this.getConverterToolProperties(),
            tool: {
                driver: {
                    ...this.getAxeProperties(),
                    rules: resultToRuleConverter.getRulePropertiesFromResults(),
                },
            },
            invocations: this.invocationConverter(
                getEnvironmentDataFromResults(results),
            ),
            artifacts: [
                this.getArtifactProperties(
                    getEnvironmentDataFromResults(results),
                ),
            ],
            results: this.convertResults(results, properties),
            taxonomies: [
                getWcagTaxonomy(
                    this.wcagLinkDataIndexer.getSortedWcagTags(),
                    this.tagsToWcagLinkData,
                ),
            ],
        };

        if (options && options.testCaseId !== undefined) {
            run.properties!.testCaseId = options.testCaseId;
        }

        if (options && options.scanId !== undefined) {
            // run.logicalId = options.scanId;
        }

        return run;
    }

    private convertResults(
        results: DecoratedAxeResults,
        properties: DictionaryStringTo<string>,
    ): Sarif.Result[] {
        const resultArray: Sarif.Result[] = [];
        const environmentData: EnvironmentData = getEnvironmentDataFromResults(
            results,
        );

        this.convertRuleResults(
            resultArray,
            results.violations,
            CustomSarif.Result.level.error,
            environmentData,
        );
        this.convertRuleResults(
            resultArray,
            results.passes,
            CustomSarif.Result.level.pass,
            environmentData,
        );
        this.convertRuleResults(
            resultArray,
            results.incomplete,
            CustomSarif.Result.level.open,
            environmentData,
        );
        this.convertRuleResultsWithoutNodes(
            resultArray,
            results.inapplicable,
            CustomSarif.Result.level.notApplicable,
            properties,
        );

        return resultArray;
    }

    private convertRuleResults(
        resultArray: Sarif.Result[],
        ruleResults: DecoratedAxeResult[],
        level: CustomSarif.Result.level,
        environmentData: EnvironmentData,
    ): void {
        if (ruleResults) {
            for (const ruleResult of ruleResults) {
                this.convertRuleResult(
                    resultArray,
                    ruleResult,
                    level,
                    environmentData,
                );
            }
        }
    }

    private convertRuleResult(
        resultArray: Sarif.Result[],
        ruleResult: DecoratedAxeResult,
        level: CustomSarif.Result.level,
        environmentData: EnvironmentData,
    ): void {
        for (const node of ruleResult.nodes) {
            resultArray.push({
                ruleId: ruleResult.id,
                ruleIndex: this.ruleIdsToRuleIndices[ruleResult.id],
                // level: level,
                message: this.convertMessage(node, level),
                locations: [
                    {
                        physicalLocation: {
                            artifactLocation: getArtifactLocation(
                                environmentData,
                            ),
                            region: {
                                snippet: {
                                    text: node.html,
                                },
                            },
                        },
                        logicalLocations: this.getLogicalLocations(node),
                    },
                ],
            });
        }
    }

    private getLogicalLocations(node: Axe.NodeResult): Sarif.LogicalLocation[] {
        const selector: string = node.target.join(';');
        // let logicalLocations: Sarif.LogicalLocation[] = [
        return [this.formatLogicalLocation(selector)];
        // if(node.xpath) {
        //     let nodeXpath: string = node.xpath.join(';');
        //     logicalLocations.push({
        //         fullyQualifiedName: nodeXpath,
        //         kind: 'element'
        //     })
        // }
        // return logicalLocations;
    }

    private formatLogicalLocation(name: string): Sarif.LogicalLocation {
        return {
            fullyQualifiedName: name,
            kind: 'element',
        };
    }

    private getPartialFingerprintsFromRule(
        ruleResult: DecoratedAxeResult,
    ): DictionaryStringTo<string> {
        return {
            ruleId: ruleResult.id,
        };
    }

    private convertMessage(
        node: Axe.NodeResult,
        level: CustomSarif.Result.level,
    ): Sarif.Message {
        const textArray: string[] = [];
        const markdownArray: string[] = [];

        if (level === CustomSarif.Result.level.error) {
            const allAndNone = node.all.concat(node.none);
            this.convertMessageChecks(
                'Fix all of the following:',
                allAndNone,
                textArray,
                markdownArray,
            );
            this.convertMessageChecks(
                'Fix any of the following:',
                node.any,
                textArray,
                markdownArray,
            );
        } else {
            const allNodes = node.all.concat(node.none).concat(node.any);
            this.convertMessageChecks(
                'The following tests passed:',
                allNodes,
                textArray,
                markdownArray,
            );
        }

        return {
            text: textArray.join(' '),
            markdown: markdownArray.join('\n\n'),
        };
    }

    private convertMessageChecks(
        heading: string,
        checkResults: Axe.CheckResult[],
        textArray: string[],
        markdownArray: string[],
    ): void {
        if (checkResults.length > 0) {
            const textLines: string[] = [];
            const richTextLines: string[] = [];

            textLines.push(heading);
            richTextLines.push(this.escapeForMarkdown(heading));

            for (const checkResult of checkResults) {
                const message = isNotEmpty(checkResult.message)
                    ? checkResult.message
                    : checkResult.id;

                textLines.push(message + '.');
                richTextLines.push('- ' + this.escapeForMarkdown(message));
            }

            textArray.push(textLines.join(' '));
            markdownArray.push(richTextLines.join('\n'));
        }
    }

    private escapeForMarkdown(s: string): string {
        return s ? s.replace(/</g, '&lt;') : '';
    }

    private convertRuleResultsWithoutNodes(
        resultArray: Sarif.Result[],
        ruleResults: DecoratedAxeResult[],
        level: CustomSarif.Result.level,
        properties: DictionaryStringTo<string>,
    ): void {
        if (ruleResults) {
            for (const ruleResult of ruleResults) {
                const partialFingerprints = this.getPartialFingerprintsFromRule(
                    ruleResult,
                );
                // resultArray.push({
                // ruleId: ruleResult.id,
                // level: level,
                // properties: {
                // ...properties,
                // tags: ['Accessibility'],
                // },
                // partialFingerprints: partialFingerprints,
                // });
            }
        }
    }
}
