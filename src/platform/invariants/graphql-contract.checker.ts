import * as fs from 'fs';
import * as path from 'path';
import { GraphQLSchema, parse, validate } from 'graphql';

import { CheckResult, Checker, findFiles } from './runner';

/**
 * GraphQL contract integrity for the Admin Dashboard (INV-015).
 *
 * WHY THIS EXISTS
 * ---------------
 * Every custom Dashboard route is a hand-written GraphQL client. When a query
 * names a field that the Admin schema does not expose, GraphQL rejects the whole
 * operation — the response carries no data at all. If the component then renders
 * `data?.someList?.items ?? []`, that rejection is indistinguishable from "this
 * tenant genuinely has no rows", so a broken financial ledger renders as a clean
 * empty table with no error anywhere.
 *
 * Two incidents of exactly this shape were found in the mandates/attempts
 * screens (`providerCustomerId`, `mandateId`, `activatedAt`, `revokedAt`,
 * `providerOrderId`, `providerTransactionId` did not exist) — the Dashboard
 * looked healthy while showing nothing.
 *
 * The detector below validates *every* document a Dashboard file can send,
 * whether it was declared with the typed `graphql()` helper (checked by
 * `tsc -p tsconfig.dashboard.json`) or as a raw untyped template string
 * (checked by nothing at all until now).
 */

export interface DashboardDocument {
    /** Repo-relative POSIX path. */
    file: string;
    /** 1-based line of the opening backtick. */
    line: number;
    operationName: string;
    /** True when declared via `graphql()` from `@/gql` (build-time type-checked). */
    typed: boolean;
    body: string;
}

export interface DashboardDocumentIssue {
    file: string;
    line: number;
    typed: boolean;
    operationName: string;
    problems: string[];
}

export interface DashboardContractReport {
    schemaSource: string;
    documents: DashboardDocument[];
    issues: DashboardDocumentIssue[];
    /** Files holding at least one untyped (build-time-unchecked) document. */
    untypedFiles: string[];
}

/** Matches the start of a GraphQL operation or fragment definition. */
const OPERATION_RE = /^\s*(query|mutation|fragment)\s+([A-Za-z_][A-Za-z0-9_]*)/;

/**
 * Extracts every GraphQL document literal from a Dashboard source file.
 *
 * Comments are deliberately walked rather than stripped: a docblock that
 * mentions a field name must not be mistaken for an operation, hence the strict
 * "must start with query/mutation/fragment" test on the literal body.
 */
export function extractDocumentsFromSource(source: string, relativePath: string): DashboardDocument[] {
    const documents: DashboardDocument[] = [];
    const literal = /`((?:[^`\\]|\\.)*)`/g;
    let match: RegExpExecArray | null;

    while ((match = literal.exec(source)) !== null) {
        // Unescape escaped backticks and drop `${...}` interpolations so the
        // remainder can be parsed as GraphQL.
        const body = match[1].replace(/\\`/g, '`').replace(/\$\{[^}]*\}/g, '');
        const operation = OPERATION_RE.exec(body);
        if (!operation) {
            continue;
        }
        const line = source.slice(0, match.index).split('\n').length;
        const typed = /graphql\(\s*$/.test(source.slice(0, match.index));
        documents.push({ file: relativePath, line, operationName: operation[2], typed, body });
    }

    return documents;
}

export function extractDashboardDocuments(rootDir: string): DashboardDocument[] {
    const documents: DashboardDocument[] = [];
    for (const file of findDashboardSourceFiles(rootDir)) {
        const source = fs.readFileSync(path.join(rootDir, file), 'utf-8');
        documents.push(...extractDocumentsFromSource(source, file));
    }
    return documents;
}

/**
 * Validates documents against a schema. A document that cannot even be parsed
 * is reported as a single synthetic problem rather than throwing, so one
 * malformed query cannot hide the rest of the report.
 */
export function validateDocuments(
    schema: GraphQLSchema,
    documents: DashboardDocument[],
): DashboardDocumentIssue[] {
    const issues: DashboardDocumentIssue[] = [];

    for (const document of documents) {
        let problems: string[] = [];
        try {
            problems = validate(schema, parse(document.body)).map(error => error.message);
        } catch (err) {
            problems = [`Document could not be parsed: ${(err as Error).message}`];
        }
        if (problems.length > 0) {
            issues.push({
                file: document.file,
                line: document.line,
                typed: document.typed,
                operationName: document.operationName,
                problems,
            });
        }
    }

    return issues;
}

export function buildReport(
    schema: GraphQLSchema,
    schemaSource: string,
    rootDir: string,
): DashboardContractReport {
    const documents = extractDashboardDocuments(rootDir);
    const issues = validateDocuments(schema, documents);
    const untypedFiles = Array.from(
        new Set(documents.filter(document => !document.typed).map(document => document.file)),
    ).sort();

    return { schemaSource, documents, issues, untypedFiles };
}

export function formatIssues(issues: DashboardDocumentIssue[]): string {
    return issues
        .map(
            issue =>
                `  ${issue.file}:${issue.line} [${issue.typed ? 'typed' : 'untyped'}] ` +
                `${issue.operationName} → ${issue.problems.join('; ')}`,
        )
        .join('\n');
}

/**
 * Static invariant checker (INV-015): no Dashboard GraphQL document may
 * reference a field, argument or type the Admin schema does not expose.
 */
export class DashboardGraphqlContractChecker implements Checker {
    name = 'dashboard-graphql-contract';

    constructor(
        private readonly rootDir: string,
        private readonly loadAdminSchema: () => Promise<GraphQLSchema>,
    ) {}

    async check(): Promise<CheckResult> {
        const schema = await this.loadAdminSchema();
        const report = buildReport(schema, 'src/vendure-config.ts', this.rootDir);

        const scanned = report.documents.length;
        const typed = report.documents.filter(document => document.typed).length;

        if (report.issues.length > 0) {
            return {
                checker: this.name,
                name: 'dashboard-document-validity',
                passed: false,
                severity: 'error',
                message:
                    `${report.issues.length} of ${scanned} Dashboard GraphQL document(s) are invalid ` +
                    'against the Admin schema — these operations fail at runtime and render as empty datasets',
                details: formatIssues(report.issues),
            };
        }

        return {
            checker: this.name,
            name: 'dashboard-document-validity',
            passed: true,
            severity: 'info',
            message: `${scanned} Dashboard GraphQL document(s) validate against the Admin schema (${typed} typed, ${scanned - typed} untyped)`,
            details:
                report.untypedFiles.length > 0
                    ? `Untyped documents remain in: ${report.untypedFiles.join(', ')}`
                    : undefined,
        };
    }
}

/** All files under any plugin's `dashboard/` folder that can issue GraphQL. */
export function findDashboardSourceFiles(rootDir: string): string[] {
    return findFiles(['src/plugins/*/dashboard/**/*.ts', 'src/plugins/*/dashboard/**/*.tsx'], rootDir)
        .map(file => path.relative(rootDir, file).split(path.sep).join('/'))
        .sort();
}
