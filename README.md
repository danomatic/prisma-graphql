# prisma-graphql
Utilities for mapping GraphQL to Prisma field selections

## Example

```ts
export const resolvers = {
  Query: {
    posts: (_, args, context, info) =>
      prisma.posts.findMany({
        select: getPrismaSelect(info, 'Post'),
      }),
  },
};
```
