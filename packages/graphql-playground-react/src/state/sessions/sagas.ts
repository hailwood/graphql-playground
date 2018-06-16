import {
  takeLatest,
  ForkEffect,
  call,
  select,
  takeEvery,
  put,
} from 'redux-saga/effects'
import { delay } from 'redux-saga'
import { getSelectedSession } from './selectors'
import getSelectedOperationName from '../../components/Playground/util/getSelectedOperationName'
import { getQueryFacts } from '../../components/Playground/util/getQueryFacts'
import { fromJS, is } from 'immutable'
import {
  editQuery,
  setVariableToType,
  setOperations,
  setOperationName,
  schemaFetchingSuccess,
  schemaFetchingError,
  fetchSchema,
  runQuery,
  setTracingSupported,
  setQueryTypes,
} from './actions'
import { getRootMap, getNewStack } from '../../components/Playground/util/stack'
import { DocsSessionState } from '../docs/reducers'
import { setStacks } from '../docs/actions'
import { HistoryState } from '../history/reducers'
import { addHistoryItem } from '../history/actions'
import { schemaFetcher } from './fetchingSagas'
import { getSelectedWorkspace, getSettings } from '../workspace/reducers'
import { getSessionDocsState } from '../docs/selectors'
import { getQueryTypes } from '../../components/Playground/util/getQueryTypes'
import { parse } from 'graphql'
import { Session } from './reducers'
import { safely, prettify } from '../../utils'
import * as queryString from 'query-string'

function* setQueryFacts() {
  // debounce by 100 ms
  yield call(delay, 100)
  const session: Session = yield select(getSelectedSession)

  const { schema } = yield schemaFetcher.fetch(session)
  try {
    const ast = parse(session.query)
    const queryFacts = getQueryFacts(schema, ast)

    if (queryFacts) {
      const immutableQueryFacts = fromJS(queryFacts)
      const operationName = getSelectedOperationName(
        session.operations,
        session.operationName,
        immutableQueryFacts.operations,
      )
      if (
        !is(immutableQueryFacts.get('variableToType'), session.variableToType)
      ) {
        // set variableToType
        yield put(setVariableToType(immutableQueryFacts.get('variableToType')))
      }
      if (!is(immutableQueryFacts.get('operations'), session.operations)) {
        // set operations
        yield put(setOperations(immutableQueryFacts.get('operations')))
      }
      if (operationName !== session.operationName) {
        yield put(setOperationName(operationName))
      }
    }

    const queryTypes = getQueryTypes(ast)
    yield put(setQueryTypes(queryTypes))
  } catch (e) {
    const queryTypes = getQueryTypes(null)
    yield put(setQueryTypes(queryTypes))
  }
}

function* reflectQueryToUrl({ payload }) {
  // debounce by 100 ms
  yield call(delay, 100)
  if (!location.search.includes('query')) {
    return
  }

  const params = queryString.parse(location.search)
  if (typeof params.query !== 'undefined') {
    const newSearch = queryString.stringify({
      ...params,
      query: payload.query,
    })
    const url = `${location.origin}${location.pathname}?${newSearch}`
    window.history.replaceState(
      {},
      document.getElementsByTagName('title')[0].innerHTML,
      url,
    )
  }
}

function* runQueryAtPosition(action) {
  const { position } = action.payload
  const session: Session = yield select(getSelectedSession)
  if (session.operations) {
    let operationName
    const operations = session.operations.toJS()
    operations.forEach((operation: any) => {
      if (
        operation.loc &&
        operation.loc.start <= position &&
        operation.loc.end >= position
      ) {
        operationName = operation.name && operation.name.value
      }
    })
    if (operationName) {
      yield put(runQuery(operationName))
    } else {
      yield put(runQuery())
    }
  } else {
    yield put(runQuery())
  }
}

function* getSessionWithCredentials() {
  const session = yield select(getSelectedSession)
  const settings = yield select(getSettings)

  return {
    endpoint: session.endpoint,
    headers: session.headers,
    credentials: settings['request.credentials'],
  }
}

function* fetchSchemaSaga() {
  const session: Session = yield getSessionWithCredentials()
  yield schemaFetcher.fetch(session)
  try {
    yield put(schemaFetchingSuccess(session.endpoint))
  } catch (e) {
    yield put(schemaFetchingError(session.endpoint))
    yield call(delay, 5000)
    yield put(fetchSchema())
  }
}

function* refetchSchemaSaga() {
  const session: Session = yield getSessionWithCredentials()
  yield schemaFetcher.refetch(session)
  try {
    yield put(schemaFetchingSuccess(session.endpoint))
  } catch (e) {
    yield put(schemaFetchingError(session.endpoint))
    yield call(delay, 5000)
    yield put(fetchSchema())
  }
}

function* renewStacks() {
  const session: Session = yield select(getSelectedSession)
  const fetchSession = yield getSessionWithCredentials()
  const docs: DocsSessionState = yield select(getSessionDocsState)
  const result = yield schemaFetcher.fetch(fetchSession)
  const { schema, tracingSupported } = result
  if (schema) {
    const rootMap = getRootMap(schema)
    const stacks = docs.navStack
      .map(stack => getNewStack(rootMap, schema, stack))
      .filter(s => s)
    yield put(setStacks(session.id, stacks))
    yield put(setTracingSupported(tracingSupported))
  }
}

function* addToHistory({ payload }) {
  const { sessionId } = payload
  const workspace = yield select(getSelectedWorkspace)
  const session = workspace.getIn(['sessions', sessionId])

  const history: HistoryState = workspace.get('history')

  const exists = history.toKeyedSeq().find(item => is(item, session))
  if (!exists) {
    yield put(addHistoryItem(session))
  }
}

function* prettifyQuery() {
  const session = yield select(getSelectedSession)
  const settings = yield select(getSettings)
  const prettyQuery = prettify(session.query, settings['prettier.printWidth'])
  yield put(editQuery(prettyQuery))
}

export const sessionsSagas = [
  takeLatest('GET_QUERY_FACTS', safely(setQueryFacts)),
  takeLatest('SET_OPERATION_NAME', safely(setQueryFacts)),
  takeEvery('EDIT_QUERY', safely(setQueryFacts)),
  takeEvery('EDIT_QUERY', safely(reflectQueryToUrl)),
  takeEvery('RUN_QUERY_AT_POSITION', safely(runQueryAtPosition)),
  takeLatest('FETCH_SCHEMA', safely(fetchSchemaSaga)),
  takeLatest('REFETCH_SCHEMA', safely(refetchSchemaSaga)),
  takeLatest('SCHEMA_FETCHING_SUCCESS', safely(renewStacks)),
  takeEvery('QUERY_SUCCESS' as any, safely(addToHistory)),
  takeLatest('PRETTIFY_QUERY', safely(prettifyQuery)),
]

// needed to fix typescript
export { ForkEffect }
