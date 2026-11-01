import { useParams } from '@tanstack/react-router'
import { PointsView } from './PointsView'
import { QuizView } from './QuizView'
import {
  BankView,
  ExercisesView,
  FactsView,
  PendingView,
  TopicsView,
} from './OtherViews'
import { isTab } from './tabs'

const VIEWS = {
  puntos: PointsView,
  quiz: QuizView,
  banco: BankView,
  temas: TopicsView,
  ejercicios: ExercisesView,
  pendientes: PendingView,
  datos: FactsView,
} as const

export function TabView() {
  const { tab } = useParams({ from: '/$team/$who/$tab' })
  const View = isTab(tab) ? VIEWS[tab] : PointsView
  return <View />
}
