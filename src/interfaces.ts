import type {
  PgCodecAttribute,
  PgCodecRelation,
  PgCodecWithAttributes,
  PgRegistry,
  PgResource,
  PgResourceParameter,
  PgResourceUnique,
} from 'postgraphile/@dataplan/pg';

export interface PgCodecRelationWithName
  extends PgCodecRelation<PgCodecWithAttributes, PgTableResource> {
  name: string;
  resource: string;
}
export interface PgTableResource
  extends PgResource<
    string,
    PgCodecWithAttributes,
    PgResourceUnique[],
    PgResourceParameter[],
    PgRegistry
  > {}

type BasicFieldInfo = {name: string; type: string};

interface RelationshipKeyMutationFields {
  byKeys?: BasicFieldInfo[];
  byNodeId?: BasicFieldInfo;
}

export interface RelationshipInputFields {
  create?: BasicFieldInfo;
  connect: RelationshipKeyMutationFields;
  update: RelationshipKeyMutationFields;
  delete: RelationshipKeyMutationFields;
}
export interface PgCodecAttributeWithName extends PgCodecAttribute {
  name: string;
}

export interface PgRelationInputData
  extends PgCodecRelation<PgCodecWithAttributes, PgTableResource> {
  relationName: string;
  fieldName: string;
  matchedAttributes: {
    local: PgCodecAttributeWithName;
    remote: PgCodecAttributeWithName;
  }[];
}

export type RelationInputTypeInfo =
  | {
      fieldName: string;
      typeName: string;
      relationName: string;
      method: 'create';
      mode?: undefined;
      unique?: undefined;
    }
  | {
      fieldName: string;
      typeName: string;
      relationName: string;
      method: 'connect' | 'update' | 'delete' | 'disconnect';
      mode: 'node';
      unique: PgResourceUnique;
    }
  | {
      fieldName: string;
      typeName: string;
      relationName: string;
      method: 'connect' | 'update' | 'delete' | 'disconnect';
      mode: 'keys';
      unique: PgResourceUnique;
    };
