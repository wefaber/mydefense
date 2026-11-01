import { Chip } from '@wefaber/ui'
import type { Visibility } from '../../shared/types'

/** Private / public picker with the sentence that says what each one means. */
export function VisibilityField({
  value,
  onChange,
}: {
  value: Visibility
  onChange: (v: Visibility) => void
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-body-lg font-medium">Quién lo ve</legend>
      <div className="flex gap-2">
        <Chip
          className="h-11 px-3 sm:h-7"
          selected={value === 'private'}
          onClick={() => onChange('private')}
        >
          Privado
        </Chip>
        <Chip
          className="h-11 px-3 sm:h-7"
          selected={value === 'public'}
          onClick={() => onChange('public')}
        >
          Público
        </Chip>
      </div>
      <p className="text-meta text-muted">
        {value === 'private'
          ? 'Solo las personas del equipo lo encuentran.'
          : 'Cualquiera puede practicar con él, sin cuenta.'}
      </p>
    </fieldset>
  )
}
