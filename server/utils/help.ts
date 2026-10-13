import slugify from 'slugify'
import { customAlphabet } from 'nanoid'
import pinyin from 'pinyinlite'
import { eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { helpArticle } from '#layers/feedlog/server/db/schemas'
import { CJK_RANGE, HELP_SHORT_ID_ALPHABET, HELP_SHORT_ID_LENGTH } from '#layers/feedlog/shared/constants/help'

const CJK = new RegExp(`[${CJK_RANGE}]`)

const shortId = customAlphabet(HELP_SHORT_ID_ALPHABET, HELP_SHORT_ID_LENGTH)

export function generateHelpShortId(): string {
  return shortId()
}

export function generateHelpSlug(title: string): string {
  // Keep non-Chinese runs intact so product names and version numbers stay readable.
  const latin = pinyin(title, { keepUnrecognized: true })
    .map(([reading], index) => reading === title[index] ? reading : ` ${reading} `)
    .join('')
  return slugify(latin, { lower: true, strict: true }).slice(0, 80)
}

export function cjkBigrams(text: string): string {
  const out: string[] = []
  for (let i = 0; i < text.length - 1; i++) {
    if (CJK.test(text[i]!) && CJK.test(text[i + 1]!)) out.push(text.slice(i, i + 2))
  }
  return out.join(' ')
}

export function buildHelpTsv(title: string, description: string | null, content: string): SQL {
  const body = stripMarkdown(content)
  const desc = description ?? ''
  return sql`
    setweight(to_tsvector('english', ${title}), 'A') || setweight(to_tsvector('simple', ${cjkBigrams(title)}), 'A') ||
    setweight(to_tsvector('english', ${desc}), 'B') || setweight(to_tsvector('simple', ${cjkBigrams(desc)}), 'B') ||
    setweight(to_tsvector('english', ${body}), 'C') || setweight(to_tsvector('simple', ${cjkBigrams(body)}), 'C')
  `
}

export async function withHelpShortId<T>(insert: (shortId: string) => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await insert(generateHelpShortId())
    }
    catch (err) {
      const error = err as { code?: string; cause?: { code?: string } }
      if ((error.cause?.code ?? error.code) !== '23505') throw err
    }
  }
  throw createError({ statusCode: 500, message: 'Failed to generate article id' })
}

export async function nextHelpArticlePosition(collectionId: string): Promise<number> {
  const db = useDB()

  const [max] = await db
    .select({ position: sql<number>`cast(coalesce(max(${helpArticle.position}), -1) as int)` })
    .from(helpArticle)
    .where(eq(helpArticle.collectionId, collectionId))

  return (max?.position ?? -1) + 1
}
