// An empty network security group with whatever name it is handed. In
// shortCircuit.bicep that name is known only during the deploy.
param location string
param name string

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: name
  location: location
}
