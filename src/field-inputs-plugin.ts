import {PgInsertSingleStep, PgUpdateSingleStep} from '@dataplan/pg';
import {
  type FieldArgs,
  ObjectStep,
  type SetterStep,
  type __TrackedValueStep,
} from 'grafast';
import {EXPORTABLE} from 'graphile-build';
import {
  type GraphQLInputFieldConfigMap,
  type GraphQLInputType,
  GraphQLList,
  GraphQLNonNull,
} from 'graphql';
import type {PgRelationInputData, PgTableResource} from './interfaces.ts';
import {
  connectResolver,
  createResolver,
  disconnectResolver,
  updateResolver,
} from './plans/index.ts';
import {
  getSpecs,
  isInsertable,
  isPgTableResource,
  isUpdatable,
} from './utils/resource.ts';

declare global {
  namespace GraphileBuild {
    interface Inflection {
      relationInputField(
        this: Inflection,
        relationship: PgRelationInputData
      ): string;
      relationInputType(
        this: Inflection,
        relationship: PgRelationInputData
      ): string;
    }
    interface ScopeInputObject {
      isRelationInputType?: boolean;
    }
    interface ScopeInputObjectFieldsField {
      isRelationInputField?: boolean;
      isRelationCreateInputField?: boolean;
      isRelationConnectByNodeInputField?: boolean;
      isRelationConnectByKeysInputField?: boolean;
      isRelationDisconnectByNodeInputField?: boolean;
      isRelationDisconnectByKeysInputField?: boolean;
      isRelationUpdateByNodeInputField?: boolean;
      isRelationUpdateByKeysInputField?: boolean;
      isRelationDeleteByNodeInputField?: boolean;
      isRelationDeleteByKeysInputField?: boolean;
    }
  }
}

export const PgRelationInputsPlugin: GraphileConfig.Plugin = {
  name: 'PgRelationInputsPlugin',
  description: 'Adds input types for relationships on pg table resource',
  version: '0.0.1',
  after: [
    'PgRelationInputsInitCreatePlugin',
    'PgRelationInputsConnectUpdateDeletePlugin',
  ],
  experimental: true,

  inflection: {
    add: {
      relationInputField(_options, relationship) {
        const {
          isReferencee,
          isUnique,
          localAttributes,
          remoteAttributes,
          remoteResource,
        } = relationship;

        const attributes = !isReferencee ? localAttributes : remoteAttributes;
        const resourceName = isUnique
          ? remoteResource.name
          : this.pluralize(remoteResource.name);

        return this.camelCase(`${resourceName}-by-${attributes.join('-and-')}`);
      },
      relationInputType(_options, {relationName}) {
        return this.upperCamelCase(`${relationName}Input`);
      },
    },
  },

  schema: {
    hooks: {
      init(_, build) {
        const {inflection} = build;

        const duplicateTypes = new Set<string>();

        const tableResources = Object.values(
          build.input.pgRegistry.pgResources
        ).filter(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          (resource) => isPgTableResource(resource)
        );

        for (const resource of tableResources) {
          const relations = build.pgRelationInputsTypes[resource.name] ?? [];
          const relationFields =
            build.pgRelationInputsFields[resource.name] ?? [];

          for (const relation of relations) {
            const {
              relationName,
              remoteResource,
              isUnique,
              isReferencee,
              remoteAttributes,
            } = relation;

            const inputFields = relationFields.filter(
              (r) => r.relationName === relationName
            );

            if (!inputFields) continue;

            const typeName = inflection.relationInputType(relation);

            if (!duplicateTypes.has(typeName)) {
              duplicateTypes.add(typeName);

              build.recoverable(null, () => {
                const getType = (type: GraphQLInputType) => {
                  return isUnique || !isReferencee
                    ? type
                    : new GraphQLList(new GraphQLNonNull(type));
                };

                build.registerInputObjectType(
                  typeName,
                  {
                    isRelationInputType: true,
                  },
                  () => ({
                    assertStep: ObjectStep,
                    description: build.wrapDescription(
                      `Relationship input type for ${relationName}`,
                      'type'
                    ),
                    fields: ({fieldWithHooks}) => {
                      return Object.fromEntries(
                        inputFields.map(
                          ({fieldName, typeName, method, mode, unique}) => {
                            const resolver = (() => {
                              switch (method) {
                                case 'create':
                                  return createResolver(build, relation);
                                case 'connect':
                                  return connectResolver(
                                    build,
                                    relation,
                                    mode,
                                    unique
                                  );
                                case 'update':
                                  return updateResolver(
                                    build,
                                    relation,
                                    mode,
                                    unique
                                  );
                                case 'disconnect':
                                  return disconnectResolver(
                                    build,
                                    relation,
                                    mode,
                                    unique
                                  );
                                default:
                                  return null;
                              }
                            })();

                            return [
                              fieldName,
                              fieldWithHooks(
                                {
                                  fieldName,

                                  isRelationCreateInputField:
                                    method === 'create',
                                  isRelationConnectByNodeInputField:
                                    method === 'connect' && mode === 'node',
                                  isRelationConnectByKeysInputField:
                                    method === 'connect' && mode === 'keys',
                                  isRelationDisconnectByNodeInputField:
                                    method === 'disconnect' && mode === 'node',
                                  isRelationDisconnectByKeysInputField:
                                    method === 'disconnect' && mode === 'keys',
                                  isRelationUpdateByNodeInputField:
                                    method === 'update' && mode === 'node',
                                  isRelationUpdateByKeysInputField:
                                    method === 'update' && mode === 'keys',
                                  isRelationDeleteByNodeInputField:
                                    method === 'delete' && mode === 'node',
                                  isRelationDeleteByKeysInputField:
                                    method === 'delete' && mode === 'keys',
                                },
                                {
                                  description: build.wrapDescription(
                                    method === 'create'
                                      ? `A ${remoteResource.name} created and linked to this object`
                                      : mode === 'node'
                                        ? `${inflection.upperCamelCase(method)} a ${remoteResource.name} by node Id linked to this object`
                                        : `${inflection.upperCamelCase(method)} a ${remoteResource.name} by keys (${remoteAttributes.join(', ')}) linked to this object`,
                                    'field'
                                  ),
                                  type: getType(
                                    build.getInputTypeByName(typeName)
                                  ),
                                  ...(resolver
                                    ? {
                                        autoApplyAfterParentApplyPlan: true,
                                        applyPlan: EXPORTABLE(
                                          (
                                            PgInsertSingleStep,
                                            PgUpdateSingleStep,
                                            resolver
                                          ) =>
                                            function plan(
                                              $parent,
                                              fieldArgs,
                                              info
                                            ) {
                                              if (
                                                $parent instanceof
                                                  PgInsertSingleStep ||
                                                $parent instanceof
                                                  PgUpdateSingleStep
                                              ) {
                                                resolver(
                                                  $parent,
                                                  fieldArgs,
                                                  info
                                                );
                                              }
                                            },
                                          [
                                            PgInsertSingleStep,
                                            PgUpdateSingleStep,
                                            resolver,
                                          ]
                                        ),
                                      }
                                    : {}),
                                }
                              ),
                            ];
                          }
                        )
                      );
                    },
                  }),
                  `Creating input type for relationship ${relationName}`
                );
              });
            }
          }
        }
        return _;
      },
      GraphQLInputObjectType_fields(fields, build, context) {
        const {inflection, wrapDescription} = build;
        const {
          fieldWithHooks,
          scope: {isPgRowType, pgCodec, isInputType, isPgPatch},
        } = context;

        if (isPgRowType && pgCodec && (isInputType || isPgPatch)) {
          const resource = build.input.pgRegistry.pgResources[pgCodec.name];
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          if (resource && isPgTableResource(resource)) {
            const relations = build.pgRelationInputsTypes[resource.name] ?? [];
            const inputFields: GraphQLInputFieldConfigMap = {};

            for (const relation of relations) {
              const typeName = inflection.relationInputType(relation);
              const InputType = build.getInputTypeByName(typeName);

              inputFields[relation.fieldName] = fieldWithHooks(
                {
                  fieldName: relation.fieldName,
                  isRelationInputType: true,
                },
                () => ({
                  description: wrapDescription(
                    `Nested connector type for ${relation.relationName}`,
                    'field'
                  ),
                  type: InputType,
                  autoApplyAfterParentApplyPlan: true,
                  applyPlan: EXPORTABLE(
                    (PgInsertSingleStep, PgUpdateSingleStep) =>
                      function plan(
                        $obj:
                          | SetterStep
                          | PgInsertSingleStep
                          | PgUpdateSingleStep,
                        fieldArgs: FieldArgs
                      ) {
                        if (
                          $obj instanceof PgInsertSingleStep ||
                          $obj instanceof PgUpdateSingleStep
                        ) {
                          fieldArgs.apply($obj);
                        }
                      },
                    [PgInsertSingleStep, PgUpdateSingleStep]
                  ),
                })
              );
            }

            const rootFields = mapPgRelationshipRootFields(
              build,
              resource,
              Object.keys(inputFields)
            );

            for (const [fieldName, paths] of Object.entries(rootFields)) {
              build.pgRelationshipMutationRootFields.set(fieldName, paths);
            }

            return build.extend(
              fields,
              inputFields,
              `Adding nested relationships to ${pgCodec.name}`
            );
          }
        }
        return fields;
      },

      GraphQLInputObjectType_fields_field(field, _build, context) {
        const {isPgUpdateInputType, fieldName} = context.scope;

        if (isPgUpdateInputType && fieldName === 'patch') {
          return {
            ...field,
            autoApplyAfterParentApplyPlan: true,
            applyPlan: EXPORTABLE(
              () =>
                function plan($object: PgUpdateSingleStep, args: FieldArgs) {
                  const $item = $object.get('result');
                  args.apply($item);
                },
              []
            ),
          };
        }

        return field;
      },

      GraphQLObjectType_fields_field(field, build, context) {
        const {
          scope: {isRootMutation, fieldName},
        } = context;

        if (isRootMutation) {
          const codec = build.pgRootFieldNamesToCodec.get(fieldName);
          if (!codec) return field;
          const inputTypes = build.pgRelationInputsTypes[codec.name] ?? [];
          const rootFields =
            build.pgRelationshipMutationRootFields.get(fieldName);
          if (!rootFields || !inputTypes) return field;
          return {
            ...field,
            plan: EXPORTABLE(
              (field, rootFields) =>
                function plan($parent: __TrackedValueStep, fieldArgs, info) {
                  if (!field.plan) return $parent;

                  const $object = field.plan(
                    $parent,
                    fieldArgs,
                    info
                  ) as ObjectStep;
                  const $item = $object.get('result');

                  for (const path of rootFields) {
                    fieldArgs.apply($item, path);
                  }

                  return $object;
                },
              [field, rootFields]
            ),
          };
        }

        return field;
      },
    },
  },
};

/**
 * Determine the root mutation input fields on the localResource to apply the args to
 * e.g., createParent => ['input', 'parent', 'childrenByTheirDadParentId'], ['input', 'parent', 'childrenByTheirMomParentId']
 */
const mapPgRelationshipRootFields = <
  TFieldName extends string = string,
  TResource extends PgTableResource = PgTableResource,
>(
  build: GraphileBuild.Build,
  resource: TResource,
  connectorFields: string[]
): Record<TFieldName, string[][]> => {
  const fieldNames = new Set<string>();
  const paths: string[][] = [];

  if (isInsertable(build, resource)) {
    fieldNames.add(build.inflection.createField(resource));
    build.pgRootFieldNamesToCodec.set(
      build.inflection.createField(resource),
      resource
    );
    paths.push(['input', build.inflection.tableFieldName(resource)]);
  }
  if (isUpdatable(build, resource)) {
    // get the localResource specs to determine the root fields
    // to apply the arguments through
    const updateSpecs = getSpecs(build, resource, 'resource:update');
    for (const {uniqueMode, unique} of updateSpecs) {
      if (uniqueMode === 'node') {
        build.pgRootFieldNamesToCodec.set(
          build.inflection.updateNodeField({resource, unique}),
          resource
        );
      } else {
        build.pgRootFieldNamesToCodec.set(
          build.inflection.updateByKeysField({resource, unique}),
          resource
        );
      }
    }
  }

  const allPaths = connectorFields.reduce((memo, connectorFieldName) => {
    memo.push(...paths.map((path) => [...path, connectorFieldName]));
    return memo;
  }, [] as string[][]);

  return Object.fromEntries(
    [...fieldNames.values()].map((fieldName) => {
      return [fieldName, allPaths];
    })
  ) as Record<TFieldName, string[][]>;
};
