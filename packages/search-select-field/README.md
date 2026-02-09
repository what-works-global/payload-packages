# Payload Search Select Field

Server-backed search select field and plugin for Payload. The client component queries a shared endpoint
and passes the current search query plus any currently selected values.

## Usage

Add the plugin:

```ts
import { searchSelectPlugin } from '@whatworks/payload-search-select-field'

export default buildConfig({
  plugins: [searchSelectPlugin()],
})
```

Add a field with `selectSearch` (recommended):

```ts
import { selectSearch } from '@whatworks/payload-search-select-field'

selectSearch({
  name: 'stripeCustomer',
  hasMany: true,
  searchFunction: async ({ query, selectedValues }) => {
    return [
      { value: 'cus_123', label: `Result for ${query}` },
      ...selectedValues.map((value) => ({
        value,
        label: `Selected: ${value}`,
      })),
    ]
  },
  admin: {
    components: {
      Field: '@whatworks/payload-search-select-field/client#SearchSelectField',
    },
  },
})
```

`searchFunction` receives:
- `query`: the current input text.
- `selectedValues`: an array of currently selected values (empty array when nothing is selected).
- `req`, `field`, and `collection`/`global` context.

The client component calls the shared endpoint path from `searchSelectEndpoint`.
