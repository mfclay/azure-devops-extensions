// The resource subscription.bicep and resourceGroup.bicep tag with the stand-in secret. A network security
// group with no rules costs nothing and needs nothing else to exist.
param location string

@description('Two stacks use this module, at different scopes, so each names its own group.')
param name string = 'nsg-bicep-whatif-smoke'

@secure()
param smokeSecret string

param stamp string

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: name
  location: location
  tags: {
    purpose: 'bicep-whatif smoke test'
    smokeSecret: '${smokeSecret}|${stamp}'
  }
}
