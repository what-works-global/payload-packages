# Payload Dynamic Search Select Field

Server-backed search select field and plugin for Payload.

## Usage

- Add the plugin:

```ts
import { searchSelectPlugin } from '@whatworks/payload-search-select-field'

export default buildConfig({
  plugins: [searchSelectPlugin()],
})
```

- Add a field:

```ts
import { selectSearch } from '@whatworks/payload-search-select-field'

selectSearch({
  name: 'stripeCustomer',
  custom: {
    searchFunction: async ({ query, limit }) => {
      return [{ value: 'cus_123', label: `Result for ${query}` }]
    },
  },
  admin: {
    components: {
      Field: '@whatworks/payload-search-select-field/client#SearchSelectField',
    },
  },
})
```

The client component calls the shared endpoint path from `searchSelectEndpoint`.
