// A user-assigned identity, free, whose principal id exists only once it does.
// shortCircuit.bicep names a resource after it to make the what-if short-circuit.
param location string

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-bicep-whatif-smoke'
  location: location
}

output principalId string = identity.properties.principalId
