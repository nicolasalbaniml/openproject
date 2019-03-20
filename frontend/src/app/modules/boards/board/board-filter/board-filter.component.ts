import {Component, Input, OnDestroy, OnInit, Output} from "@angular/core";
import {Board} from "core-app/modules/boards/board/board";
import {CurrentProjectService} from "core-components/projects/current-project.service";
import {QueryFormDmService} from "core-app/modules/hal/dm-services/query-form-dm.service";
import {WorkPackageStatesInitializationService} from "core-components/wp-list/wp-states-initialization.service";
import {QueryFormResource} from "core-app/modules/hal/resources/query-form-resource";
import {IsolatedQuerySpace} from "core-app/modules/work_packages/query-space/isolated-query-space";
import {QueryResource} from "core-app/modules/hal/resources/query-resource";
import {HalResourceService} from "core-app/modules/hal/services/hal-resource.service";
import {WorkPackageTableFiltersService} from "core-components/wp-fast-table/state/wp-table-filters.service";
import {componentDestroyed} from "ng2-rx-componentdestroyed";
import {QueryFilterInstanceResource} from "core-app/modules/hal/resources/query-filter-instance-resource";
import {UrlParamsHelperService} from "core-components/wp-query/url-params-helper";
import {StateService} from "@uirouter/core";
import {DebouncedEventEmitter} from "core-components/angular/debounced-event-emitter";
import {skip} from "rxjs/internal/operators";
import {ApiV3Filter} from "core-components/api/api-v3/api-v3-filter-builder";

@Component({
  selector: 'board-filter',
  templateUrl: './board-filter.component.html'
})
export class BoardFilterComponent implements OnInit, OnDestroy {
  @Input() public board:Board;

  @Output() public filters = new DebouncedEventEmitter<ApiV3Filter[]>(componentDestroyed(this));

  constructor(private readonly currentProjectService:CurrentProjectService,
              private readonly querySpace:IsolatedQuerySpace,
              private readonly halResourceService:HalResourceService,
              private readonly wpStatesInitialization:WorkPackageStatesInitializationService,
              private readonly wpTableFilters:WorkPackageTableFiltersService,
              private readonly urlParamsHelper:UrlParamsHelperService,
              private readonly $state:StateService,
              private readonly queryFormDm:QueryFormDmService) {
  }

  ngOnInit():void {
    // Initially load the form once to be able to render filters
    this.loadQueryForm();

    // Update checksum service whenever filters change
    this.updateChecksumOnFilterChanges();
  }

  ngOnDestroy():void {
    // Compliance
  }

  private updateChecksumOnFilterChanges() {
    this.wpTableFilters
      .observeUntil(componentDestroyed(this))
      .pipe(skip(1))
      .subscribe(() => {

        let query_props:string|null = null;
        const filters:QueryFilterInstanceResource[] = this.wpTableFilters.current;
        let filterHash = this.urlParamsHelper.buildV3GetFilters(filters);

        if (filters.length > 0) {
          query_props = JSON.stringify(filterHash);
        }

        this.filters.emit(filterHash);

        this.$state.go('.', { query_props: query_props }, {custom: {notify: false}});
      });
  }

  private loadQueryForm() {
    this.queryFormDm
      .loadWithParams(
        { filters: JSON.stringify(this.board.filters) },
        undefined,
        this.currentProjectService.id
      )
      .then((form:QueryFormResource) => {
        const query:QueryResource = this.halResourceService.createHalResourceOfClass(
          QueryResource,
          form.payload.$source
        );

        this.querySpace.query.putValue(query);
        this.wpStatesInitialization.updateStatesFromForm(query, form);
      });
  }
}
