import {css} from '@emotion/core';
import {browserHistory} from 'react-router';
import PropTypes from 'prop-types';
import React from 'react';
import Reflux from 'reflux';
import createReactClass from 'create-react-class';
import isEqual from 'lodash/isEqual';
import queryString from 'query-string';
import styled from '@emotion/styled';

import {
  IconActivity,
  IconChevron,
  IconGraph,
  IconIssues,
  IconLab,
  IconLightning,
  IconProject,
  IconReleases,
  IconSettings,
  IconSiren,
  IconStack,
  IconStats,
  IconSupport,
  IconTelescope,
} from 'app/icons';
import {extractSelectionParameters} from 'app/components/organizations/globalSelectionHeader/utils';
import {getDiscoverLandingUrl} from 'app/views/eventsV2/utils';
import {hideSidebar, showSidebar} from 'app/actionCreators/preferences';
import {t} from 'app/locale';
import ConfigStore from 'app/stores/configStore';
import Feature from 'app/components/acl/feature';
import GuideAnchor from 'app/components/assistant/guideAnchor';
import HookStore from 'app/stores/hookStore';
import PreferencesStore from 'app/stores/preferencesStore';
import SentryTypes from 'app/sentryTypes';
import localStorage from 'app/utils/localStorage';
import space from 'app/styles/space';
import theme from 'app/utils/theme';
import withOrganization from 'app/utils/withOrganization';
import {logExperiment} from 'app/utils/analytics';

import {getSidebarPanelContainer} from './sidebarPanel';
import Broadcasts from './broadcasts';
import OnboardingStatus from './onboardingStatus';
import LegacyOnboardingStatus from './legacyOnboardingStatus';
import ServiceIncidents from './serviceIncidents';
import SidebarDropdown from './sidebarDropdown';
import SidebarHelp from './help';
import SidebarItem from './sidebarItem';

class Sidebar extends React.Component {
  static propTypes = {
    organization: SentryTypes.Organization,
    collapsed: PropTypes.bool,
    location: PropTypes.object,
  };

  constructor(props) {
    super(props);
    this.state = {
      horizontal: false,
      currentPanel: '',
      showPanel: false,
    };

    if (!window.matchMedia) {
      return;
    }
    // TODO(billy): We should consider moving this into a component
    this.mq = window.matchMedia(`(max-width: ${theme.breakpoints[0]})`);
    this.mq.addListener(this.handleMediaQueryChange);
    this.state.horizontal = this.mq.matches;
  }

  componentDidMount() {
    document.body.classList.add('body-sidebar');
    document.addEventListener('click', this.flyoutCloseHandler);

    this.hashChangeHandler();
    this.doCollapse(this.props.collapsed);

    const {organization} = this.props;
    logExperiment({
      organization,
      key: 'OnboardingSidebarV2Experiment',
      unitName: 'org_id',
      unitId: parseInt(organization?.id, 10),
      param: 'exposed',
    });
  }

  UNSAFE_componentWillReceiveProps(nextProps) {
    const {collapsed, location} = this.props;
    const nextLocation = nextProps.location;

    // Close active panel if we navigated anywhere
    if (nextLocation && location && location.pathname !== nextLocation.pathname) {
      this.hidePanel();
    }

    if (collapsed === nextProps.collapsed) {
      return;
    }

    this.doCollapse(nextProps.collapsed);
  }

  // Sidebar doesn't use children, so don't use it to compare
  // Also ignore location, will re-render when routes change (instead of query params)
  shouldComponentUpdate(
    {children: _children, location: _location, ...nextPropsToCompare},
    nextState
  ) {
    const {
      children: _childrenCurrent,
      location: _locationCurrent,
      ...currentPropsToCompare
    } = this.props;

    return (
      !isEqual(currentPropsToCompare, nextPropsToCompare) ||
      !isEqual(this.state, nextState)
    );
  }

  componentWillUnmount() {
    document.removeEventListener('click', this.flyoutCloseHandler);
    document.body.classList.remove('body-sidebar');

    if (this.mq) {
      this.mq.removeListener(this.handleMediaQueryChange);
      this.mq = null;
    }
  }

  doCollapse(collapsed) {
    if (collapsed) {
      document.body.classList.add('collapsed');
    } else {
      document.body.classList.remove('collapsed');
    }
  }

  toggleSidebar = () => {
    const {collapsed} = this.props;

    if (!collapsed) {
      hideSidebar();
    } else {
      showSidebar();
    }
  };

  hashChangeHandler = () => {
    if (window.location.hash === '#welcome') {
      this.togglePanel('todos');
    }
  };

  handleMediaQueryChange = changed => {
    this.setState({
      horizontal: changed.matches,
    });
  };

  // Hide slideout panel
  hidePanel = () => {
    if (!this.state.sidePanel && this.state.currentPanel === '') {
      return;
    }

    this.setState({
      showPanel: false,
      currentPanel: '',
    });
  };

  // Keep the global selection querystring values in the path
  navigateWithGlobalSelection = (pathname, evt) => {
    const globalSelectionRoutes = [
      'dashboards',
      'issues',
      'events',
      'releases',
      'user-feedback',
      'discover',
      'discover/queries',
      'discover/results',
      'performance',
      'releasesv2',
    ].map(route => `/organizations/${this.props.organization.slug}/${route}/`);

    // Only keep the querystring if the current route matches one of the above
    if (globalSelectionRoutes.includes(pathname)) {
      const query = extractSelectionParameters(this.props.location.query);

      // Handle cmd-click (mac) and meta-click (linux)
      if (evt.metaKey) {
        const q = queryString.stringify(query);
        evt.currentTarget.href = `${evt.currentTarget.href}?${q}`;
        return;
      }

      evt.preventDefault();
      browserHistory.push({pathname, query});
    }

    this.hidePanel();
  };

  // Show slideout panel
  showPanel = panel => {
    this.setState({
      showPanel: true,
      currentPanel: panel,
    });
  };

  togglePanel = panel => {
    if (this.state.currentPanel === panel) {
      this.hidePanel();
    } else {
      this.showPanel(panel);
    }
  };

  flyoutCloseHandler = evt => {
    // Ignore if click occurs within sidebar
    if (this.sidebarRef.current && this.sidebarRef.current.contains(evt.target)) {
      return;
    }

    // Ignore if click occurs within sidebar flyout panel
    const flyout = getSidebarPanelContainer();
    if (flyout && flyout.contains(evt.target)) {
      return;
    }

    this.hidePanel();
  };

  /**
   * Determine which mix of discovers and events tabs to show for an account.
   */
  discoverSidebarState() {
    const {organization} = this.props;
    // Default all things to off
    const sidebarState = {
      discover1: false,
      discover2: false,
      events: false,
    };

    // Bail as we can't do any more checks.
    if (!organization || !organization.features) {
      return sidebarState;
    }
    const optState = localStorage.getItem('discover:version');
    const features = organization.features;

    if (features.includes('discover-basic')) {
      // If there is no opt-out state show discover2
      if (!optState || optState === '2') {
        sidebarState.discover2 = true;
      }
      // User wants discover1
      if (optState === '1') {
        sidebarState.discover1 = true;
        sidebarState.events = true;
      }
      return sidebarState;
    }

    // If an account has the old features they continue to have
    // access to them.
    if (features.includes('discover')) {
      sidebarState.discover1 = true;
    }
    if (features.includes('events')) {
      sidebarState.events = true;
    }

    // If an organization doesn't have events, or discover-basic
    // Enable the tab so we can show an upsell state in saas.
    if (!sidebarState.events) {
      sidebarState.discover2 = true;
    }

    return sidebarState;
  }

  sidebarRef = React.createRef();

  render() {
    const {organization, collapsed} = this.props;
    const {currentPanel, showPanel, horizontal} = this.state;
    const config = ConfigStore.getConfig();
    const user = ConfigStore.get('user');
    const hasPanel = !!currentPanel;
    const orientation = horizontal ? 'top' : 'left';
    const sidebarItemProps = {
      orientation,
      collapsed,
      hasPanel,
    };
    const hasOrganization = !!organization;

    const discoverState = this.discoverSidebarState();

    return (
      <StyledSidebar ref={this.sidebarRef} collapsed={collapsed}>
        <SidebarSectionGroupPrimary>
          <SidebarSection>
            <SidebarDropdown
              onClick={this.hidePanel}
              orientation={orientation}
              collapsed={collapsed}
              org={organization}
              user={user}
              config={config}
            />
          </SidebarSection>

          <PrimaryItems>
            {hasOrganization && (
              <React.Fragment>
                <SidebarSection>
                  <SidebarItem
                    {...sidebarItemProps}
                    index
                    onClick={this.hidePanel}
                    icon={<IconProject size="md" />}
                    label={t('Projects')}
                    to={`/organizations/${organization.slug}/projects/`}
                  />
                  <SidebarItem
                    {...sidebarItemProps}
                    onClick={(_id, evt) =>
                      this.navigateWithGlobalSelection(
                        `/organizations/${organization.slug}/issues/`,
                        evt
                      )
                    }
                    icon={<IconIssues size="md" />}
                    label={t('Issues')}
                    to={`/organizations/${organization.slug}/issues/`}
                    id="issues"
                  />

                  {discoverState.events && (
                    <Feature
                      features={['events']}
                      hookName="feature-disabled:events-sidebar-item"
                      organization={organization}
                    >
                      <SidebarItem
                        {...sidebarItemProps}
                        onClick={(_id, evt) =>
                          this.navigateWithGlobalSelection(
                            `/organizations/${organization.slug}/events/`,
                            evt
                          )
                        }
                        icon={<IconStack size="md" />}
                        label={t('Events')}
                        to={`/organizations/${organization.slug}/events/`}
                        id="events"
                      />
                    </Feature>
                  )}

                  {discoverState.discover2 && (
                    <Feature
                      hookName="feature-disabled:discover2-sidebar-item"
                      features={['discover-basic']}
                      organization={organization}
                    >
                      <GuideAnchor position="right" target="discover_sidebar">
                        <SidebarItem
                          {...sidebarItemProps}
                          onClick={(_id, evt) =>
                            this.navigateWithGlobalSelection(
                              getDiscoverLandingUrl(organization),
                              evt
                            )
                          }
                          icon={<IconTelescope size="md" />}
                          label={t('Discover')}
                          to={getDiscoverLandingUrl(organization)}
                          id="discover-v2"
                          isNew
                        />
                      </GuideAnchor>
                    </Feature>
                  )}
                  <Feature features={['performance-view']} organization={organization}>
                    <SidebarItem
                      {...sidebarItemProps}
                      onClick={(_id, evt) =>
                        this.navigateWithGlobalSelection(
                          `/organizations/${organization.slug}/performance/`,
                          evt
                        )
                      }
                      icon={<IconLightning size="md" />}
                      label={t('Performance')}
                      to={`/organizations/${organization.slug}/performance/`}
                      id="performance"
                    />
                  </Feature>
                  <Feature features={['incidents']} organization={organization}>
                    <SidebarItem
                      {...sidebarItemProps}
                      onClick={(_id, evt) =>
                        this.navigateWithGlobalSelection(
                          `/organizations/${organization.slug}/alerts/`,
                          evt
                        )
                      }
                      icon={<IconSiren size="md" />}
                      label={t('Alerts')}
                      to={`/organizations/${organization.slug}/alerts/`}
                      id="alerts"
                    />
                  </Feature>

                  <SidebarItem
                    {...sidebarItemProps}
                    onClick={(_id, evt) =>
                      this.navigateWithGlobalSelection(
                        `/organizations/${organization.slug}/releases/`,
                        evt
                      )
                    }
                    icon={<IconReleases size="md" />}
                    label={t('Releases')}
                    to={`/organizations/${organization.slug}/releases/`}
                    id="releases"
                  />
                  <SidebarItem
                    {...sidebarItemProps}
                    onClick={(_id, evt) =>
                      this.navigateWithGlobalSelection(
                        `/organizations/${organization.slug}/user-feedback/`,
                        evt
                      )
                    }
                    icon={<IconSupport size="md" />}
                    label={t('User Feedback')}
                    to={`/organizations/${organization.slug}/user-feedback/`}
                    id="user-feedback"
                  />
                </SidebarSection>

                <SidebarSection>
                  <Feature features={['discover']} organization={organization}>
                    <SidebarItem
                      {...sidebarItemProps}
                      index
                      onClick={this.hidePanel}
                      icon={<IconGraph size="md" />}
                      label={t('Dashboards')}
                      to={`/organizations/${organization.slug}/dashboards/`}
                      id="customizable-dashboards"
                    />
                  </Feature>

                  {discoverState.discover1 && (
                    <Feature
                      features={['discover']}
                      hookName="feature-disabled:discover-sidebar-item"
                      organization={organization}
                    >
                      <SidebarItem
                        {...sidebarItemProps}
                        onClick={this.hidePanel}
                        icon={<IconTelescope size="md" />}
                        label={t('Discover')}
                        to={`/organizations/${organization.slug}/discover/`}
                        id="discover"
                      />
                    </Feature>
                  )}
                  <Feature features={['monitors']} organization={organization}>
                    <SidebarItem
                      {...sidebarItemProps}
                      onClick={(_id, evt) =>
                        this.navigateWithGlobalSelection(
                          `/organizations/${organization.slug}/monitors/`,
                          evt
                        )
                      }
                      icon={<IconLab size="md" />}
                      label={t('Monitors')}
                      to={`/organizations/${organization.slug}/monitors/`}
                      id="monitors"
                    />
                  </Feature>
                  <Feature features={['releases-v2']} organization={organization}>
                    <SidebarItem
                      {...sidebarItemProps}
                      onClick={(_id, evt) =>
                        this.navigateWithGlobalSelection(
                          `/organizations/${organization.slug}/releases-v2/`,
                          evt
                        )
                      }
                      icon={<IconReleases size="md" />}
                      label={t('Releases v2')}
                      to={`/organizations/${organization.slug}/releases-v2/`}
                      id="releasesv2"
                    />
                  </Feature>
                </SidebarSection>

                <SidebarSection>
                  <SidebarItem
                    {...sidebarItemProps}
                    onClick={this.hidePanel}
                    icon={<IconActivity size="md" />}
                    label={t('Activity')}
                    to={`/organizations/${organization.slug}/activity/`}
                    id="activity"
                  />
                  <SidebarItem
                    {...sidebarItemProps}
                    onClick={this.hidePanel}
                    icon={<IconStats size="md" />}
                    label={t('Stats')}
                    to={`/organizations/${organization.slug}/stats/`}
                    id="stats"
                  />
                </SidebarSection>

                <SidebarSection>
                  <SidebarItem
                    {...sidebarItemProps}
                    onClick={this.hidePanel}
                    icon={<IconSettings size="md" />}
                    label={t('Settings')}
                    to={`/settings/${organization.slug}/`}
                    id="settings"
                  />
                </SidebarSection>
              </React.Fragment>
            )}
          </PrimaryItems>
        </SidebarSectionGroupPrimary>

        {hasOrganization && (
          <SidebarSectionGroup>
            {organization.experiments?.OnboardingSidebarV2Experiment === 1 &&
              !horizontal && (
                <SidebarSection noMargin noPadding>
                  <OnboardingStatus
                    org={organization}
                    currentPanel={currentPanel}
                    onShowPanel={() => this.togglePanel('todos')}
                    showPanel={showPanel}
                    hidePanel={this.hidePanel}
                    collapsed={collapsed}
                  />
                </SidebarSection>
              )}

            <SidebarSection>
              {HookStore.get('sidebar:bottom-items').length > 0 &&
                HookStore.get('sidebar:bottom-items')[0]({
                  organization,
                  ...sidebarItemProps,
                })}
              <SidebarHelp
                orientation={orientation}
                collapsed={collapsed}
                hidePanel={this.hidePanel}
                organization={organization}
              />
              <Broadcasts
                orientation={orientation}
                collapsed={collapsed}
                showPanel={showPanel}
                currentPanel={currentPanel}
                onShowPanel={() => this.togglePanel('broadcasts')}
                hidePanel={this.hidePanel}
                organization={organization}
              />
              <ServiceIncidents
                orientation={orientation}
                collapsed={collapsed}
                showPanel={showPanel}
                currentPanel={currentPanel}
                onShowPanel={() => this.togglePanel('statusupdate')}
                hidePanel={this.hidePanel}
              />
            </SidebarSection>

            {organization.experiments?.OnboardingSidebarV2Experiment !== 1 &&
              !horizontal && (
                <SidebarSection noMargin>
                  <LegacyOnboardingStatus
                    org={organization}
                    currentPanel={currentPanel}
                    onShowPanel={() => this.togglePanel('todos')}
                    showPanel={showPanel}
                    hidePanel={this.hidePanel}
                    collapsed={collapsed}
                  />
                </SidebarSection>
              )}

            {!horizontal && (
              <SidebarSection>
                <SidebarCollapseItem
                  data-test-id="sidebar-collapse"
                  {...sidebarItemProps}
                  icon={<StyledIconChevron collapsed={collapsed} />}
                  label={collapsed ? t('Expand') : t('Collapse')}
                  onClick={this.toggleSidebar}
                />
              </SidebarSection>
            )}
          </SidebarSectionGroup>
        )}
      </StyledSidebar>
    );
  }
}

const SidebarContainer = createReactClass({
  displayName: 'SidebarContainer',
  contextTypes: {
    location: PropTypes.any,
  },
  mixins: [Reflux.listenTo(PreferencesStore, 'onPreferenceChange')],
  getInitialState() {
    return {
      collapsed: PreferencesStore.getInitialState().collapsed,
    };
  },

  onPreferenceChange(store) {
    if (store.collapsed === this.state.collapsed) {
      return;
    }

    this.setState({
      collapsed: store.collapsed,
    });
  },

  render() {
    return (
      <Sidebar {...this.props} collapsed={this.state.collapsed} location={location} />
    );
  },
});

export {Sidebar};
export default withOrganization(SidebarContainer);

const responsiveFlex = css`
  display: flex;
  flex-direction: column;

  @media (max-width: ${theme.breakpoints[0]}) {
    flex-direction: row;
  }
`;

const StyledSidebar = styled('div')`
  background: ${p => p.theme.sidebar.background};
  background: linear-gradient(${p => p.theme.gray4}, ${p => p.theme.gray5});
  color: ${p => p.theme.sidebar.color};
  line-height: 1;
  padding: 12px 0 2px; /* Allows for 32px avatars  */
  width: ${p => p.theme.sidebar.expandedWidth};
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  justify-content: space-between;
  z-index: ${p => p.theme.zIndex.sidebar};
  ${responsiveFlex};
  ${p => p.collapsed && `width: ${p.theme.sidebar.collapsedWidth};`};

  @media (max-width: ${p => p.theme.breakpoints[0]}) {
    top: 0;
    left: 0;
    right: 0;
    height: ${p => p.theme.sidebar.mobileHeight};
    bottom: auto;
    width: auto;
    padding: 0 ${space(1)};
    align-items: center;
  }
`;

const SidebarSectionGroup = styled('div')`
  ${responsiveFlex};
`;

const SidebarSectionGroupPrimary = styled(SidebarSectionGroup)`
  /* necessary for child flexing on msedge and ff */
  min-height: 0;
  min-width: 0;
  flex: 1;
  /* expand to fill the entire height on mobile */
  @media (max-width: ${p => p.theme.breakpoints[0]}) {
    height: 100%;
    align-items: center;
  }
`;

const PrimaryItems = styled('div')`
  overflow: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  -ms-overflow-style: -ms-autohiding-scrollbar;
  @media (max-height: 600px) and (min-width: ${p => p.theme.breakpoints[0]}) {
    border-bottom: 1px solid ${p => p.theme.gray3};
    padding-bottom: ${space(1)};
    box-shadow: rgba(0, 0, 0, 0.15) 0px -10px 10px inset;
    &::-webkit-scrollbar {
      background-color: transparent;
      width: 8px;
    }
    &::-webkit-scrollbar-thumb {
      background: ${p => p.theme.gray3};
      border-radius: 8px;
    }
  }
  @media (max-width: ${p => p.theme.breakpoints[0]}) {
    overflow-y: visible;
    flex-direction: row;
    height: 100%;
    align-items: center;
    border-right: 1px solid ${p => p.theme.gray3};
    padding-right: ${space(1)};
    margin-right: ${space(0.5)};
    box-shadow: rgba(0, 0, 0, 0.15) -10px 0px 10px inset;
    ::-webkit-scrollbar {
      display: none;
    }
  }
`;

const SidebarSection = styled(SidebarSectionGroup)`
  ${p => !p.noMargin && `margin: ${space(1)} 0`};
  ${p => !p.noPadding && 'padding: 0 19px'};

  @media (max-width: ${p => p.theme.breakpoints[0]}) {
    margin: 0;
    padding: 0;
  }

  &:empty {
    display: none;
  }
`;

const ExpandedIcon = css`
  transition: 0.3s transform ease;
  transform: rotate(270deg);
`;
const CollapsedIcon = css`
  transform: rotate(90deg);
`;
const StyledIconChevron = styled(({collapsed, ...props}) => (
  <IconChevron
    direction="left"
    size="md"
    circle
    css={[ExpandedIcon, collapsed && CollapsedIcon]}
    {...props}
  />
))``;

const SidebarCollapseItem = styled(SidebarItem)`
  @media (max-width: ${p => p.theme.breakpoints[0]}) {
    display: none;
  }
`;
