import type { Oas3Rule } from '../../visitors';
import { NormalizedNodeType, ScalarSchema } from '../../types';
import { oasTypeOf, matchesJsonSchemaType, getSuggest } from '../utils';
import { isRef } from '../../ref-utils';

function isNamedType(
  t: NormalizedNodeType | ScalarSchema | null | undefined,
): t is NormalizedNodeType {
  return typeof t?.name === 'string';
}

export const Oas3Spec: Oas3Rule = () => {
  return {
    any(node: any, { report, type, location, key, resolve }) {
      const nodeType = oasTypeOf(node);
      if (type.items) {
        if (nodeType !== 'array') {
          report({
            message: `Expected type '${type.name} (array)' but got '${nodeType}'`,
          });
        }
        return;
      } else if (nodeType !== 'object') {
        report({
          message: `Expected type '${type.name} (object)' but got '${nodeType}'`,
        });
        return;
      }

      const required =
        typeof type.required === 'function' ? type.required(node, key) : type.required;
      for (let propName of required || []) {
        if (!(node as object).hasOwnProperty(propName)) {
          report({
            message: `The field '${propName}' must be present on this level.`,
            location: [{ reportOnKey: true }],
          });
        }
      }

      for (const propName of Object.keys(node)) {
        const propLocation = location.child([propName]);
        let propValue = node[propName];
        let propType = type.properties[propName] !== undefined ? type.properties[propName] : type.additionalProperties;
        if (propType !== undefined) {
          propType = typeof propType === 'function' ? propType(propValue, propName) : propType;
        }

        if (isNamedType(propType)) {
          continue; // do nothing for named schema, it is executed with the next any call
        }

        const propSchema = propType;
        const propValueType = oasTypeOf(propValue);

        if (propSchema === undefined) {
          if (propName.startsWith('x-')) continue;
          report({
            message: `Property \`${propName}\` is not expected here`,
            suggest: getSuggest(propName, Object.keys(type.properties)),
            location: propLocation.key(),
          });
          continue;
        }

        if (propSchema === null) {
          continue; // just defined, no validation
        }

        if (propSchema.referenceable && isRef(propValue)) {
          propValue = resolve(propValue).node
        }

        if (propSchema.enum) {
          if (!propSchema.enum.includes(propValue)) {
            report({
              location: propLocation,
              message: `'${propName}' can be one of following only: ${propSchema.enum
                .map((i) => `"${i}"`)
                .join(', ')}`,
              suggest: getSuggest(propValue, propSchema.enum),
            });
          }
        } else if (propSchema.type && !matchesJsonSchemaType(propValue, propSchema.type)) {
          report({
            message: `Expected type '${propSchema.type}' but got '${propValueType}'`,
            location: propLocation,
          });
        } else if (propValueType === 'array' && propSchema.items?.type) {
          const itemsType = propSchema.items?.type;
          for (let i = 0; i < propValue.length; i++) {
            const item = propValue[i];
            if (!matchesJsonSchemaType(item, itemsType)) {
              report({
                message: `Expected type '${itemsType}' but got '${oasTypeOf(item)}'`,
                location: propLocation.child([i]),
              });
            }
          }
        }
      }
    },
  };
};
