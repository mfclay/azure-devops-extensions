// The resource main.bicep tags with the stand-in secret. A network security
// group with no rules costs nothing and needs nothing else to exist.
param location string

@secure()
param smokeSecret string

param stamp string

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: 'nsg-bicep-whatif-smoke'
  location: location
  tags: {
    purpose: 'bicep-whatif smoke test'
    smokeSecret: '${smokeSecret}|${stamp}'
  }
}
