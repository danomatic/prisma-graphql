import { FieldNode, GraphQLResolveInfo } from 'graphql';
import { SelectionNode } from 'graphql/language/ast';
import { Prisma } from '@prisma/client';
import { DMMF } from '@prisma/client/runtime/library';

const { models, types } = Prisma.dmmf.datamodel;

/**
 * Default field selects for each Model or composite type
 */
export const basePrismaSelects: PrismaSelects = {};

export const modelsIndexed = models.reduce((indexed, model) => {
    indexed[model.name] = model;
    return indexed;
}, {} as Record<Prisma.ModelName, DMMF.Model>);

export const typesIndexed = types.reduce((indexed, model) => {
    indexed[model.name] = model;
    return indexed;
}, {} as Record<string, DMMF.Model>);

export type PrismaModelSelect<
    M extends Prisma.ModelName
> = Prisma.TypeMap['model'][M]['operations']['findMany']['args']['select'];

export type PrismaTypeSelect = Record<string, boolean | any>;

export type PrismaSelect<M extends Prisma.ModelName = any> =
    | PrismaModelSelect<M>
    | PrismaTypeSelect;

export type PrismaSelects = {
    [M in Prisma.ModelName]?:
        | PrismaModelSelect<M>
        | ((selectedFields: string[]) => PrismaModelSelect<M>);
} & {
    [Type: string]: PrismaTypeSelect | ((selectedFields: string[]) => PrismaTypeSelect);
};

export const getPrismaQuery = <M extends Prisma.ModelName>(
    info: GraphQLResolveInfo,
    modelName: M
): Prisma.TypeMap['model'][M]['operations']['findMany']['args'] => {
    if (!info) {
        return {};
    }

    return {
        select: getPrismaSelect(info, modelName),
    };
};

export const getPrismaSelect = <M extends Prisma.ModelName>(
    info: GraphQLResolveInfo,
    modelName: M
): PrismaModelSelect<M> => {
    if (!info) {
        return undefined;
    }

    const fields = getRootFields(info);
    return getSelect(fields, info, modelName);
};

export const getSelect = (
    fields: ReadonlyArray<FieldNode>,
    info: GraphQLResolveInfo,
    modelName: Prisma.ModelName | string
): PrismaSelect => {
    if (!info) {
        return undefined;
    }

    const model = modelsIndexed[modelName] ?? typesIndexed[modelName];
    if (!model) {
        throw new Error(`Model or type ${modelName} not found`);
    }

    const selectedFieldNames = getFieldNames(fields);

    const selectedModelFieldNames = getFieldNames(getModelFields(fields, model));

    let select: PrismaSelects[keyof PrismaSelects] = basePrismaSelects[modelName] || {};
    if (typeof select === 'function') {
        select = select(selectedFieldNames);
    }

    selectedModelFieldNames.forEach(modelField => {
        if (!(modelField in select)) {
            select[modelField] = true;
        }
    });
    if (model.primaryKey) {
        model.primaryKey.fields.forEach(primaryKeyField => {
            if (!(primaryKeyField in select)) {
                select[primaryKeyField] = true;
            }
        });
    }
    getModelIdFields(model).forEach(idField => {
        if (!(idField.name in select)) {
            select[idField.name] = true;
        }
    });
    getModelDateFields(model).forEach(dateField => {
        if (!(dateField.name in select)) {
            select[dateField.name] = true;
        }
    });

    const relationFields: FieldNode[] = getRelationFields(fields, model).concat(
        getCompositeTypeFields(fields, model)
    );

    relationFields.forEach((field: FieldNode) => {
        const as = field.name.value;
        // const variables = info.variableValues;
        const relationField = model.fields.find(modelField => modelField.name === field.name.value);
        const selections = field.selectionSet
            ? resolveFragments(field.selectionSet.selections, info)
            : [];

        console.log(as, model.name, model.fields, field.selectionSet.selections, selections);

        select[as] =
            selections.length > 0
                ? {
                      select: getSelect(selections, info, relationField.type),
                  }
                : true;
    });

    return select;
};

export const getModelIdFields = (model: DMMF.Model): DMMF.Field[] => {
    return model.fields.filter(
        field =>
            field.name.endsWith('Id') ||
            field.name.endsWith('Ids') ||
            field.name === 'id' ||
            field.name === '_id'
    );
};

export const getModelDateFields = (model: DMMF.Model): DMMF.Field[] => {
    return model.fields.filter(
        (field: DMMF.Field) => field.type.includes('Date') || field.name.endsWith('Date')
    );
};

export const getCompositeTypeFields = (
    fields: ReadonlyArray<FieldNode>,
    model: DMMF.Model
): FieldNode[] => {
    return fields.filter(field =>
        model.fields.some(
            modelField =>
                modelField.name === field.name.value &&
                modelField.type &&
                !(modelField.type in modelsIndexed) &&
                modelField.type in typesIndexed
        )
    );
};

export const getScalarFieldNames = (
    fields: FieldNode[] | ReadonlyArray<FieldNode>,
    model: DMMF.Model
): string[] => {
    return getFieldNames(getScalarFields(fields, model));
};

export const getRelationFields = (
    fields: FieldNode[] | ReadonlyArray<FieldNode>,
    model: DMMF.Model
): FieldNode[] =>
    fields.filter(field =>
        model.fields.some(
            modelField => modelField.name === field.name.value && modelField.type in modelsIndexed
        )
    );

export const getScalarFields = (
    fields: FieldNode[] | ReadonlyArray<FieldNode>,
    model: DMMF.Model
): FieldNode[] =>
    fields.filter(field =>
        model.fields.some(
            modelField =>
                modelField.name === field.name.value &&
                modelField.type &&
                (['scalar', 'enum'].includes(modelField.kind) ||
                    (!(modelField.type in modelsIndexed) && !(modelField.type in typesIndexed)))
        )
    );

export const resolveFragments = (
    selections: SelectionNode[] | readonly SelectionNode[],
    info: GraphQLResolveInfo
): FieldNode[] => {
    const fragments = info.fragments;
    const resolved = selections.slice();

    selections.forEach(selection => {
        if (selection.kind === 'FragmentSpread') {
            const fragment = fragments[selection.name.value];
            resolved.splice(
                resolved.indexOf(selection),
                1,
                ...resolveFragments(fragment.selectionSet.selections, info)
            );
        }
    });
    return resolved as FieldNode[];
};

export const getModelFields = (
    fields: ReadonlyArray<FieldNode>,
    model: DMMF.Model
): FieldNode[] => {
    return fields.filter(field =>
        model.fields.some(modelField => modelField.name === field.name.value)
    );
};

export const getRootFields = (info: GraphQLResolveInfo): FieldNode[] => {
    if (info.fieldNodes.length === 0 || !info.fieldNodes[0].selectionSet) {
        return [];
    }

    const fields = resolveFragments(
        info.fieldNodes[0].selectionSet.selections,
        info
    ) as FieldNode[];
    return fields.filter(field => field.name.value !== '__typename');
};

const getFieldNames = (fields: ReadonlyArray<FieldNode>) =>
    fields.map((fieldSelection: FieldNode) => fieldSelection.name.value);
