// The smoke pipeline's `bicep` template at management-group scope: one policy
// definition, which costs nothing and does nothing until something assigns it,
// and nothing here does. Its metadata carries the stand-in secret, so a
// what-if that reported property values would have to redact it.
targetScope = 'managementGroup'

@secure()
@description('A stand-in secret, set in managementGroup.bicepparam. Never a real one: it is committed.')
param smokeSecret string

@description('Changes every run, so that the metadata is always a modify. Set by managementGroup.bicepparam.')
param stamp string

resource smoke 'Microsoft.Authorization/policyDefinitions@2023-04-01' = {
  name: 'bicep-whatif-smoke'
  properties: {
    displayName: 'bicep-whatif smoke test'
    description: 'Created by the bicep-whatif smoke pipeline. Never assigned.'
    policyType: 'Custom'
    mode: 'All'
    metadata: {
      purpose: 'bicep-whatif smoke test'
      smokeSecret: '${smokeSecret}|${stamp}'
    }
    policyRule: {
      if: {
        field: 'type'
        equals: 'Microsoft.Network/networkSecurityGroups'
      }
      then: {
        effect: 'audit'
      }
    }
  }
}
