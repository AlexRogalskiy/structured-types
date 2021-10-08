/* eslint-disable prefer-spread */
import path from 'path';
import fs from 'fs';
import jsStringEscape from 'js-string-escape';
import reactPlugin from '@structured-types/react-plugin';
import propTypesPlugin from '@structured-types/prop-types-plugin';
import {
  InterfaceProp,
  isTupleProp,
  isClassLikeProp,
  isUnionProp,
  parseFiles,
  PropType,
  hasProperties,
  isFunctionProp,
  FunctionProp,
  PropKind,
  hasValue,
  isArrayProp,
  ParseOptions,
  isIndexProp,
  isStringProp,
  EnumProp,
  isEnumProp,
} from '@structured-types/api';
import { getRepoPath } from '../common/package-info';
import {
  createPropsTable,
  createPropsRow,
  PropItem,
} from '../blocks/props-table';
import { Node, NodeChildren } from '../common/types';

type GenerateKind =
  | 'props'
  | 'description'
  | 'examples'
  | 'title'
  | 'location'
  | 'all';

type ColumnNames =
  | 'name'
  | 'type'
  | 'parents'
  | 'value'
  | 'description'
  | 'all';
export class ExtractProps {
  private files: string[];
  private collapsed: string[] = [];
  private generate: GenerateKind[] = ['all'];
  private columns: ColumnNames[] = ['all'];
  private skipInherited = false;
  private topLevelProps: Record<string, PropType> = {};
  private repoNames: {
    [key: string]: {
      repo?: string;
      filePath?: string;
      packageName?: string;
      relativePath?: string;
    };
  } = {};
  constructor(files: string[]) {
    this.files = files;
  }

  private extractPropTable(
    props: PropType[],
    title?: string,
  ): ReturnType<typeof createPropsTable> {
    let parentProp: EnumProp | undefined = undefined;
    const consolidatedProps = props.filter((prop) => {
      if (
        typeof prop.parent === 'string' &&
        (this.skipInherited || this.collapsed.includes(prop.parent))
      ) {
        if (!this.skipInherited) {
          if (!parentProp) {
            parentProp = {
              name: '...props',
              kind: PropKind.Enum,
              properties: [{ kind: PropKind.Type, type: prop.parent }],
              optional: true,
            };
          } else {
            if (!parentProp.properties?.find((p) => p.type === prop.parent)) {
              parentProp.properties?.push({
                kind: PropKind.Type,
                type: prop.parent,
              });
            }
          }
        }
        return false;
      } else {
        return true;
      }
    });
    const allProps = parentProp
      ? [...consolidatedProps, parentProp]
      : consolidatedProps;
    const items: PropItem[] = allProps.map((prop) =>
      this.configurePropItem({
        name: `${
          prop.name
            ? prop.kind === PropKind.Rest
              ? `...${prop.name}`
              : prop.name
            : ''
        }`,
        isOptional: prop.optional,
        parent: prop.parent ? this.propLink(prop.parent) : undefined,

        type: this.extractPropType(prop, { extractProperties: true }),
        description: prop.description,
        value: hasValue(prop) ? prop.value : undefined,
      } as PropItem),
    );
    return createPropsTable(items, title);
  }

  private extractFunctionDeclaration(prop: FunctionProp): Node[] {
    const result: Node[] = [
      {
        type: 'text',
        value: '(',
      },
    ];
    if (prop.parameters) {
      for (let i = 0; i < prop.parameters.length; i += 1) {
        const p = prop.parameters[i];
        if (i > 0) {
          result.push({
            type: 'text',
            value: ', ',
          });
        }
        if (p.name) {
          result.push({
            type: 'inlineCode',
            value: p.name,
          });

          if (!p.optional) {
            result.push({
              type: 'text',
              value: '*',
            });
          }
          result.push({
            type: 'text',
            value: ': ',
          });
        }
        result.push(...this.extractPropType(p));
        if (!p.name && !p.optional) {
          result.push({
            type: 'text',
            value: '*',
          });
        }
      }
    }
    result.push({
      type: 'text',
      value: ')',
    });
    result.push({
      type: 'text',
      value: ' => ',
    });
    if (prop.returns) {
      result.push(...this.extractPropType(prop.returns));
    } else {
      result.push({
        type: 'text',
        value: 'void',
      });
    }
    return result;
  }
  private configurePropItem(item: PropItem): PropItem {
    const enabledColumn = (name: ColumnNames): boolean => {
      return this.columns.includes(name) || this.columns.includes('all');
    };
    return {
      name: enabledColumn('name') ? item.name : undefined,
      isOptional: item.isOptional,
      parent: enabledColumn('parents') ? item.parent : undefined,
      type: enabledColumn('type') ? item.type : undefined,
      description: enabledColumn('description') ? item.description : undefined,
    };
  }
  private extractFunction(prop: FunctionProp, _extractTable = true): Node[] {
    if (prop.parameters) {
      const { propsTable, table, visibleColumns } = this.extractPropTable(
        prop.parameters,
        'parameters',
      );
      if (table && prop.returns && prop.returns.kind !== PropKind.Void) {
        table.children.push(
          createPropsRow(
            this.configurePropItem({
              name: 'returns',
              isOptional: true,
              parent: prop.returns.parent
                ? this.propLink(prop.returns.parent)
                : undefined,
              type: this.extractPropType(prop.returns),
              description: prop.returns.description,
            }),
            visibleColumns,
          ),
        );
      }
      return propsTable;
    }
    return [];
  }
  private getPropLink = (key: string) => {
    const nameParts = key.split('.');
    return this.topLevelProps[nameParts[nameParts.length - 1]];
  };
  private extractInterface(prop: InterfaceProp): Node[] {
    const result: Node[] = [];
    if (prop.name) {
      const declaration: NodeChildren = {
        type: 'paragraph',
        children: [],
      };
      result.push(declaration);

      if (prop.extends?.length) {
        const extendsList = prop.extends.reduce(
          (acc: Node[], key: string, idx: number) => {
            const p = this.getPropLink(key);
            let result: Node[];
            if (p) {
              result = this.extractPropType(p);
            } else {
              result = [
                {
                  type: 'text',
                  value: key,
                },
              ];
            }
            if (prop.extends && idx < prop.extends.length - 1) {
              result.push({
                type: 'text',
                value: ', ',
              });
            }
            return [...acc, ...result];
          },
          [],
        );
        declaration.children.push({
          type: 'strong',
          children: [
            {
              type: 'text',
              value: 'extends ',
            },
            ...extendsList,
          ],
        });
      }
      if (isUnionProp(prop)) {
        result.push(...this.extractPropType(prop));
      } else if (hasProperties(prop) && prop.properties) {
        const { propsTable } = this.extractPropTable(
          prop.properties,
          'properties',
        );
        result.push(...propsTable);
      }
    }
    return result;
  }

  private propLink(type?: string): Node[] {
    const typeText = [
      {
        type: 'inlineCode',
        value: type,
      },
    ];
    if (typeof type === 'string') {
      const link = this.getPropLink(type);
      if (link) {
        return [
          {
            type: 'link',
            url: `#${link.name?.toLowerCase()}`,
            children: typeText,
          },
        ];
      }
    }
    return typeText;
  }

  private inlineType(prop: PropType): Node[] {
    let typeNode: Node[] | undefined = undefined;
    if (typeof prop.type === 'string') {
      typeNode = this.propLink(prop.type);
    } else if (prop.kind) {
      typeNode = [
        {
          type: 'inlineCode',
          value: `${PropKind[prop.kind].toLowerCase()}`,
        },
      ];
    }
    if (prop.name && prop.name !== prop.type) {
      return [
        {
          type: 'inlineCode',
          value: `${prop.name}`,
        },
        {
          type: 'text',
          value: `${typeNode ? ': ' : ''}`,
        },
        ...(typeNode || []),
      ];
    }
    return typeNode || [];
  }
  private typeNode(prop: PropType, showValue = true): Node[] {
    if (typeof prop.type === 'string') {
      if (typeof prop.parent === 'string') {
        return [
          ...this.propLink(prop.parent),
          {
            type: 'text',
            value: `.${prop.type}`,
          },
        ];
      }
      return this.propLink(prop.type);
    }
    if (showValue && hasValue(prop) && prop.value !== undefined) {
      const value = isStringProp(prop)
        ? `"${jsStringEscape(prop.value)}"`
        : prop.value.toString();
      return [
        {
          type: 'inlineCode',
          value,
        },
      ];
    }
    if (prop.kind) {
      const typeNode: Node[] = [
        {
          type: 'inlineCode',
          value: `${PropKind[prop.kind].toLowerCase()}`,
        },
      ];
      if (typeof prop.parent === 'string' && this.getPropLink(prop.parent)) {
        const link = this.propLink(prop.parent);
        if (link.length) {
          typeNode.push({
            type: 'text',
            value: ` (`,
          });
          typeNode.push(...link);
          typeNode.push({
            type: 'text',
            value: `)`,
          });
        }
      }
      return typeNode;
    }
    if (prop.name) {
      return [
        {
          type: 'text',
          value: prop.name,
        },
      ];
    }

    return [];
  }

  private extractPropType(
    prop: PropType,
    options?: { showValue?: boolean; extractProperties?: boolean },
  ): Node[] {
    if (prop.parent) {
      const parent = this.getPropLink(prop.parent);
      if (parent && isClassLikeProp(parent)) {
        const p = parent.properties?.find((p) => p.name === prop.name);
        if (p) {
          return this.extractType(p, options);
        }
      }
    }
    return this.extractType(prop, options);
  }
  private extractType(
    prop: PropType,
    options?: { showValue?: boolean },
  ): Node[] {
    const { showValue = false } = options || {};
    if (typeof prop.type === 'string' && this.collapsed?.includes(prop.type)) {
      return this.typeNode(prop, showValue);
    } else if ((isUnionProp(prop) || isEnumProp(prop)) && prop.properties) {
      const separator = isUnionProp(prop) ? ' | ' : ' & ';
      return [
        {
          type: 'paragraph',
          children: prop.properties?.reduce((acc: Node[], t, idx) => {
            const r = [...acc, ...this.extractPropType(t, { showValue: true })];
            if (prop.properties && idx < prop.properties.length - 1) {
              r.push({ type: 'text', value: separator });
            }
            return r;
          }, []),
        },
      ];
    } else if (isClassLikeProp(prop)) {
      const propName = typeof prop.type === 'string' ? prop.type : prop.name;
      const result: Node[] = [];
      if (typeof propName === 'string' && this.getPropLink(propName)) {
        result.push(...this.propLink(propName));
      } else if (prop.properties?.length) {
        const typeArguments: Node[] = prop.properties.reduce(
          (acc: Node[], p: PropType, idx: number) => {
            const result = [...acc, ...this.inlineType(p)];
            if (prop.properties && idx < prop.properties.length - 1) {
              result.push({
                type: 'text',
                value: ', ',
              });
            }
            return result;
          },
          [],
        );

        result.push({
          type: 'paragraph',
          children: [
            {
              type: 'text',
              value: '{ ',
            },
            ...typeArguments,
            {
              type: 'text',
              value: ' }',
            },
          ],
        });
      } else if (prop.generics?.length) {
        const genericArguments: Node[] | undefined = prop.generics?.reduce(
          (acc: Node[], p: PropType, idx: number) => {
            const result = [...acc, ...this.inlineType(p)];
            if (prop.generics && idx < prop.generics.length - 1) {
              result.push({
                type: 'text',
                value: ', ',
              });
            }
            return result;
          },
          [],
        );
        result.push(...this.typeNode(prop));
        if (genericArguments?.length) {
          result.push(
            ...[
              {
                type: 'text',
                value: '<',
              },
              ...genericArguments,
              {
                type: 'text',
                value: '>',
              },
            ],
          );
        }
      } else {
        result.push({
          type: 'text',
          value: propName,
        });
      }
      return result;
    } else if (isArrayProp(prop) && prop.properties) {
      const elements = prop.properties.reduce(
        (acc: Node[], p: PropType, idx: number) => {
          const result = this.extractPropType(p);
          if (prop.properties && idx < prop.properties.length - 1) {
            result.push({
              type: 'text',
              value: ', ',
            });
          }
          return [...acc, ...result];
        },
        [],
      ) as Node[];
      const multiProps =
        elements.length &&
        elements[0].children &&
        elements[0].children.length > 1;
      if (multiProps) {
        elements.splice(0, 0, { type: 'text', value: '(' });
        elements.push({ type: 'text', value: ')' });
      }
      elements.push({ type: 'text', value: '[]' });
      return [
        {
          type: 'paragraph',
          children: elements,
        },
      ];
    } else if (isTupleProp(prop) && prop.properties) {
      return [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: '[' },
            ...prop.properties.reduce(
              (acc: Node[], p: PropType, idx: number) => {
                const result = this.extractPropType(p);
                if (prop.properties && idx < prop.properties.length - 1) {
                  result.push({
                    type: 'text',
                    value: ', ',
                  });
                }
                return [...acc, ...result];
              },
              [],
            ),
            { type: 'text', value: ']' },
          ],
        },
      ];
    } else if (isIndexProp(prop)) {
      const results: Node[] = [
        { type: 'text', value: '[' },
        { type: 'paragraph', children: this.extractPropType(prop.index) },
        { type: 'text', value: ']' },
      ];
      if (prop.prop) {
        results.push({ type: 'text', value: ': ' });
        results.push({
          type: 'paragraph',
          children: this.extractPropType(prop.prop),
        });
      }
      return results;
      //return this.extractFunctionDeclaration(prop);
    } else if (isFunctionProp(prop)) {
      return this.extractFunctionDeclaration(prop);
    }
    return this.typeNode(prop, showValue);
  }
  private getSourceLocation(prop: PropType): Node[] {
    const { filePath } = prop;
    if (filePath) {
      if (!this.repoNames[filePath]) {
        this.repoNames[filePath] = getRepoPath(
          path.dirname(path.resolve(filePath)),
        );
        if (this.repoNames[filePath].filePath) {
          this.repoNames[filePath].packageName = JSON.parse(
            fs.readFileSync(this.repoNames[filePath].filePath || '', 'utf8'),
          ).name;
          this.repoNames[filePath].relativePath = path.relative(
            path.dirname(this.repoNames[filePath].filePath || './'),
            filePath,
          );
        }
      }

      if (this.repoNames[filePath]) {
        const { repo, relativePath, packageName } = this.repoNames[filePath];
        if (repo) {
          const { line } = prop.loc || {};
          const sourceLocation = filePath.includes('node_modules')
            ? repo
            : `${repo}/${relativePath}${line ? `#L${line}` : ''}`;
          return [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'emphasis',
                  children: [
                    {
                      type: 'text',
                      value: 'defined in ',
                    },
                    {
                      type: 'link',
                      url: sourceLocation,
                      children: [
                        {
                          type: 'text',
                          value: `${packageName}/${relativePath}`,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ];
        }
      }
    }
    return [];
  }
  private extractPropDefinition(prop: PropType): Node {
    const definition: Omit<Node, 'children'> & { children: Node[] } = {
      type: 'paragraph',
      children: [],
    };

    if (prop.kind) {
      definition.children.push({
        type: 'strong',
        children: [
          {
            type: 'inlineCode',
            value: `${prop.extension ? `${prop.extension} ` : ''}${PropKind[
              prop.kind
            ].toLowerCase()}`,
          },
        ],
      });
    } else if (typeof prop.type === 'string') {
      definition.children.push({
        type: 'strong',
        children: [
          {
            type: 'inlineCode',
            children: this.propLink(prop.type),
          },
        ],
      });
    }
    const loc = this.getSourceLocation(prop);
    if (loc.length) {
      definition.children.push({
        type: 'text',
        value: ' ',
      });
      definition.children.push(...loc);
    }

    return definition;
  }
  private generateSection(section: GenerateKind): boolean {
    return this.generate.includes(section) || this.generate.includes('all');
  }

  private extractTSType(prop: PropType): Node[] {
    const result: Node[] = [];
    if (this.generateSection('title')) {
      result.push({
        type: 'heading',
        depth: 2,
        children: [{ type: 'text', value: prop.name }],
      });
    }
    if (this.generateSection('location')) {
      result.push(this.extractPropDefinition(prop));
    }
    if (prop.description && this.generateSection('description')) {
      result.push(
        ...prop.description.split('\n').map((d) => ({
          type: 'paragraph',
          children: [
            {
              type: 'text',
              value: d,
            },
          ],
        })),
      );
    }
    if (this.generateSection('props')) {
      if (isFunctionProp(prop)) {
        result.push(...this.extractFunction(prop));
      } else if (hasProperties(prop)) {
        result.push(...this.extractInterface(prop));
      }
    }
    if (prop.examples && this.generateSection('examples')) {
      const codeExamples = prop.examples.filter((e) => e.content);
      const examples: Node = {
        type: 'paragraph',
        children: [
          {
            type: 'heading',
            depth: 3,
            children: [
              {
                type: 'text',
                value: `example${codeExamples.length > 1 ? 's' : ''}`,
              },
            ],
          },
          {
            type: 'text',
            value: '\n',
          },
        ],
      };

      codeExamples.forEach((example) => {
        examples.children?.push({
          type: 'code',
          value: example.content,
        });
      });
      result.push(examples);
    }
    return result;
  }

  public extract(
    options: ParseOptions & {
      collapsed?: string[];
      extensions?: string[];
      columns?: ColumnNames[];
      generate?: GenerateKind[];
      skipInherited?: boolean;
    },
  ): Node[] {
    const result: Node[] = [];
    if (this.files) {
      const {
        collapsed = [],
        extensions,
        generate = ['all'],
        columns = ['all'],
        skipInherited = false,
        ...parseOptions
      } = options;
      const props = parseFiles(this.files, {
        collectFilePath: true,
        collectHelpers: true,
        collectLinesOfCode: true,
        plugins: [propTypesPlugin, reactPlugin],
        ...parseOptions,
      });
      this.collapsed = collapsed;
      this.generate = generate;
      this.columns = columns;
      this.skipInherited = skipInherited;
      let propKeys = Object.keys(props);
      if (options.extract?.length) {
        const names = options.extract;
        propKeys = propKeys.sort((key1, key2) => {
          return names.indexOf(key1) - names.indexOf(key2);
        });
      }

      propKeys.forEach((key) => {
        const prop = props[key];
        if (
          key !== '__helpers' &&
          key !== '__diagnostics' &&
          (!extensions ||
            (prop.extension && extensions.includes(prop.extension)))
        ) {
          this.topLevelProps[key] = prop;
        }
      });
      const helpers = props.__helpers;
      if (helpers) {
        Object.keys(helpers).forEach((key) => {
          const prop = helpers[key];
          if (
            !extensions ||
            (prop.extension && extensions.includes(prop.extension))
          ) {
            this.topLevelProps[key] = helpers[key];
          }
        });
      }
      Object.values(this.topLevelProps).forEach((prop) => {
        const nodes = this.extractTSType(prop);
        result.push(...nodes);
      });
    }
    return result;
  }
}
