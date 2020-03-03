import React from 'react';
import withStyles from '@material-ui/core/styles/withStyles';
import CssBaseline from '@material-ui/core/CssBaseline';
import {AppBar, Typography} from '@material-ui/core';
import {DocDarkGrey, DocGrey, methodColors} from '../requests/DocConstants';
import {ExampleOnly, ShapeOnly} from '../requests/DocCodeBox';
import {DocSubGroup} from '../requests/DocSubGroup';
import {STATUS_CODES} from 'http';
import PropTypes from 'prop-types';
import Toolbar from '@material-ui/core/Toolbar';
import IconButton from '@material-ui/core/IconButton';
import Tooltip from '@material-ui/core/Tooltip';
import ClearIcon from '@material-ui/icons/Clear';
import InterpretationInfo from './InterpretationInfo';
import {withRfcContext} from '../../contexts/RfcContext';
import {JsonHelper} from '@useoptic/domain';
import Mustache from 'mustache';
import {Link} from 'react-router-dom';
import {withNavigationContext} from '../../contexts/NavigationContext';
import {PURPOSE} from '../../ContributionKeys';
import compose from 'lodash.compose';
import {DiffDocGrid} from '../requests/DocGrid';
import {getNormalizedBodyDescriptor} from '../../utilities/RequestUtilities';
import FastForwardIcon from '@material-ui/icons/FastForward';
import ReportBug from './ReportBug';
import Button from '@material-ui/core/Button';
import {withProductDemoContext} from '../navigation/ProductDemo';
import {ChangedYellowBackground} from '../../contexts/ColorContext';
import {ScalaJSHelpers} from '@useoptic/domain';

const styles = theme => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    height: '100vh'
  },
  specContainer: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    paddingRight: 20,
    paddingBottom: 350,
    overflow: 'scroll'
  },
  skipContainer: {
    display: 'flex',
    flexDirection: 'row'
  },
  requestContainer: {
    // display: 'flex',
    // flexDirection: 'column',
    // height: '100vh',
    paddingRight: 20,
    paddingBottom: 350,
    overflow: 'scroll'
  },
  remaining: {
    paddingLeft: 12,
    paddingRight: 12,
    color: DocDarkGrey,
  },
  marginPath: {
    marginTop: theme.spacing(1),
    marginLeft: 2
  },
  button: {
    margin: theme.spacing(1),
  },
  appBar: {
    borderBottom: '1px solid #e2e2e2',
    backgroundColor: ChangedYellowBackground
  },
  scroll: {
    overflow: 'scroll',
    paddingBottom: 300,
    paddingTop: 20,
  },
  fabs: {
    width: '50%',
    textAlign: 'center',
    position: 'fixed',
    bottom: 22,
    paddingRight: 30
  },
  fab: {
    margin: theme.spacing(1)
  }
});

const DiffPath = withStyles(styles)(({classes, path, method, url}) => {

  return (
    <DiffDocGrid
      left={(
        <DocSubGroup title="URL">
          <div className={classes.marginPath}>
            <Typography variant="body" component="span" style={{
              fontWeight: 600,
              color: methodColors[method.toUpperCase()]
            }}>{method.toUpperCase()}</Typography>
            <Typography variant="body" component="span" style={{marginLeft: 9, color: DocGrey}}>{url}</Typography>
          </div>
        </DocSubGroup>
      )}
      right={(
        <DocSubGroup title="Path">
          <div className={classes.marginPath}>
            <Typography variant="body" component="span" style={{
              fontWeight: 600,
              color: methodColors[method.toUpperCase()]
            }}>{method.toUpperCase()}</Typography>
            <Typography variant="body" component="span" style={{marginLeft: 9, color: DocGrey}}>{path}</Typography>
          </div>
        </DocSubGroup>
      )}
    />
  );
});

const DiffRequest = withStyles(styles)((props) => {
  const {
    classes,
    requestQueryString,
    observedQueryString,
    observedRequestBody,
    observedContentType,
    requestBody = {},
    interpretation,
    diff
  } = props;

  const {shapeId, httpContentType} = requestBody;

  const shouldShowObservedQueryString = Object.keys(observedQueryString).length > 0;
  const shouldShowSpecQueryString = shouldShowObservedQueryString;
  const shouldShowObservedExample = typeof observedRequestBody !== 'undefined';
  const shouldShowSpecExample = !!shapeId;

  const opacity = opacityForGridItem(diff, interpretation);

  return (
    <DiffDocGrid
      style={{opacity}}
      left={(
        <div id={diff && 'diff-observed'}>
          <DocSubGroup title="Observed Request">
            {diff}
            {shouldShowObservedQueryString && <ExampleOnly title="Query String" example={observedQueryString}/>}
            {shouldShowObservedExample &&
            <ExampleOnly title="Example" contentType={observedContentType} example={observedRequestBody}/>}
          </DocSubGroup>
        </div>
      )}
      right={(
        <div id={interpretation && 'interpretation-card'}>
          <DocSubGroup title="Expected Request">
            {interpretation}
            {shouldShowSpecQueryString && <ShapeOnly title="Query String Shape" disableNaming
                                                     shapeId={requestQueryString.requestParameterDescriptor.shapeDescriptor.ShapedRequestParameterShapeDescriptor.shapeId}/>}
            {shouldShowSpecExample && <ShapeOnly title="Shape" shapeId={shapeId} contentType={httpContentType}/>}
          </DocSubGroup>
        </div>
      )}
    />
  );
});

function opacityForGridItem(diff, interpretation) {
  return (!diff && !interpretation) ? .6 : 1;
}

const DiffResponse = withStyles(styles)((props) => {
  const {
    classes,
    statusCode,
    observedResponseBody,
    observedContentType,
    response,
    responseBody = {},
    diff,
    interpretation
  } = props;
  const {shapeId, httpContentType} = responseBody;

  const opacity = opacityForGridItem(diff, interpretation);
  console.log({props});

  return (
    <DiffDocGrid
      style={{opacity}}
      left={(
        <div id={diff && 'diff-observed'}>
          <DocSubGroup title={`Response Status: ${statusCode}`}>
            {diff}
            <ExampleOnly title="Response Body" contentType={observedContentType} example={observedResponseBody}/>
          </DocSubGroup>
        </div>
      )}
      right={response && (
        <div id={interpretation && 'interpretation-card'}>
          <DocSubGroup title={`${statusCode} - ${STATUS_CODES[statusCode]} Response`}>
            {interpretation}
            {shapeId && <ShapeOnly title="Response Body Shape" shapeId={shapeId}
                                   contentType={httpContentType}/>
            }
          </DocSubGroup>
        </div>
      )}
    />
  );
});

class DiffPage extends React.Component {

  getSpecForRequest(observedStatusCode) {
    const {cachedQueryResults, requestId} = this.props;
    const {requests, responses, requestParameters} = cachedQueryResults;
    const request = requests[requestId];
    const {requestDescriptor} = request;
    const {bodyDescriptor} = requestDescriptor;

    const purpose = cachedQueryResults.contributions.getOrUndefined(requestId, PURPOSE);
    console.log({cachedQueryResults});
    const queryString = Object.values(requestParameters).find(x => x.requestParameterDescriptor.requestId === requestId && x.requestParameterDescriptor.location === 'query');
    console.log({queryString});
    const requestBody = getNormalizedBodyDescriptor(bodyDescriptor);
    const response = Object.values(responses)
      .find(({responseDescriptor}) =>
        responseDescriptor.requestId === requestId &&
        responseDescriptor.httpStatusCode === observedStatusCode);

    const responseBody = response && getNormalizedBodyDescriptor(response.responseDescriptor.bodyDescriptor);

    return {
      purpose,
      queryString,
      requestBody,
      response,
      responseBody
    };

  }

  getInterpretationCard(displayContext) {
    const {interpretation, interpretationsLength, interpretationsIndex, setInterpretationIndex, applyCommands, queries} = this.props;
    if (!interpretation) {
      debugger;
    }
    const {commands, actionTitle} = interpretation;
    const context = ScalaJSHelpers.asJs(interpretation.context);
    const metadata = ScalaJSHelpers.asJs(interpretation.metadata);
    const description = ScalaJSHelpers.asJs(interpretation.description);

    const descriptionProcessed = (() => {
      const {template, fieldId, shapeId} = description;

      const inputs = {};

      if (fieldId) {
        const shapeStructure = queries.nameForFieldId(fieldId);
        const name = shapeStructure.map(({name}) => name).join(' ');
        inputs['fieldId_SHAPE'] = name;
      } else if (shapeId) {
        const shapeStructure = queries.nameForShapeId(shapeId);
        const name = shapeStructure.map(({name}) => name).join(' ');
        inputs['shapeId_SHAPE'] = name;
      }
      return Mustache.render(template, inputs);
    })();

    const color = (metadata.addedIds.length > 0 && 'green') || (metadata.changedIds.length > 0 && 'yellow') || 'blue';

    const card = (
      <InterpretationInfo
        color={color}
        title={actionTitle}
        metadata={metadata}
        description={descriptionProcessed}
        {...{interpretationsLength, interpretationsIndex, setInterpretationIndex}}
        onAccept={() => {
          const c = JsonHelper.seqToJsArray(commands);
          localStorage.setItem('request-diff-reached-approve', 'true');
          applyCommands(...c)(metadata.addedIds, metadata.changedIds);
        }}
      />

    );

    if (context.responseId && displayContext === 'response') {
      return card;
    } else if (context.inRequestBody && displayContext === 'request') {
      return card;
    } else {
      return null;
    }
  }

  getDiffCard(displayContext) {
    const {interpretation, diff} = this.props;

    const context = ScalaJSHelpers.asJs(interpretation.context);

    if (context.responseId && displayContext === 'response') {
      return diff;

    } else if (context.inRequestBody && displayContext === 'request') {
      return diff;
    } else {
      return null;
    }
  }

  handleDiscard = () => {
    this.props.onDiscard();
  };

  render() {
    const {classes, url, method, path, observed, onSkip, baseUrl, demos} = this.props;

    const {queryString, requestBody, responseBody, response, purpose} = this.getSpecForRequest(observed.statusCode);

    const metadata = ScalaJSHelpers.asJs(this.props.interpretation.metadata);
    if (!this.props.interpretation) {

    }
    const {addedIds, changedIds} = metadata;

    return (
      <div className={classes.root}>
        {demos.requestDiffDemo && demos.requestDiffDemo(!localStorage.getItem('request-diff-reached-approve'))}
        <CssBaseline/>
          <AppBar position="static" color="default" className={classes.appBar} elevation={0}>
            <Toolbar variant="dense">
              <div style={{marginRight: 20}}>
                <Link to={baseUrl}>
                  <Tooltip title="End Diff Review">
                    <IconButton size="small" aria-label="delete" className={classes.margin} color="primary"
                                disableRipple
                                onClick={this.handleDiscard}>
                      <ClearIcon fontSize="small"/>
                    </IconButton>
                  </Tooltip>
                </Link>
              </div>

              <div>
                <Typography variant="h6" color="primary">Review API Diff — {purpose}</Typography>
              </div>
              <div style={{flex: 1}}/>

            </Toolbar>
          </AppBar>


          <div className={classes.scroll}>

            <DiffDocGrid left={(
              <div className={classes.skipContainer}>
                <Typography variant="h4" color="primary">Diff Observed</Typography>
                <div style={{flex: 1}}/>
                <div style={{marginTop: -4}}>
                  <ReportBug classes={classes}/>
                  <Button endIcon={<FastForwardIcon fontSize="small"/>} color="primary" size="small" onClick={onSkip}
                          className={classes.fab}>
                    Skip
                  </Button>
                </div>
              </div>
            )}
                         right={<Typography variant="h4" color="primary">Spec Change</Typography>}/>

            <DiffPath path={path} method={method} url={url}/>
            {/*
            <DiffQueryString
              observed={observed.queryString}
              specced={queryString}
              /> */}

            <DiffRequest
              observedQueryString={observed.queryString}
              observedRequestBody={observed.requestBody}
              observedContentType={observed.requestContentType}
              requestBody={requestBody}
              requestQueryString={queryString}
              diff={this.getDiffCard('request')}
              interpretation={this.getInterpretationCard('request')}
            />

            <DiffResponse
              statusCode={observed.statusCode}
              observedResponseBody={observed.responseBody}
              observedContentType={observed.responseContentType}
              response={response}
              responseBody={responseBody}
              diff={this.getDiffCard('response')}
              interpretation={this.getInterpretationCard('response')}
            />


          </div>
          {/*<InterpretationCard/>*/}
      </div>
    );
  }
}


DiffPage.propTypes = {
  url: PropTypes.string,
  path: PropTypes.string,
  method: PropTypes.string,

  //observation
  observed: PropTypes.shape({
    statusCode: PropTypes.number,
    requestBody: PropTypes.any,
    responseBody: PropTypes.any,
  }),

  remainingInteractions: PropTypes.number
};

export default compose(
  withNavigationContext,
  withRfcContext,
  withProductDemoContext,
  withStyles(styles)
)(DiffPage);
