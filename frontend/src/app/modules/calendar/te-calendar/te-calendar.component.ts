import {Component, ElementRef, Input, OnDestroy, OnInit, SecurityContext, ViewChild, AfterViewInit, Output, EventEmitter, Injector, ViewEncapsulation, ChangeDetectionStrategy} from "@angular/core";
import {FullCalendarComponent} from '@fullcalendar/angular';
import {States} from "core-components/states.service";
import * as moment from "moment";
import { Moment } from 'moment';
import {StateService} from "@uirouter/core";
import {I18nService} from "core-app/modules/common/i18n/i18n.service";
import {NotificationsService} from "core-app/modules/common/notifications/notifications.service";
import {DomSanitizer} from "@angular/platform-browser";
import timeGrid from '@fullcalendar/timegrid';
import { EventInput, EventApi, Duration, View } from '@fullcalendar/core';
import { EventSourceError } from '@fullcalendar/core/structs/event-source';
import { ToolbarInput } from '@fullcalendar/core/types/input-types';
import {ConfigurationService} from "core-app/modules/common/config/configuration.service";
import {TimeEntryDmService} from "core-app/modules/hal/dm-services/time-entry-dm.service";
import {FilterOperator} from "core-components/api/api-v3/api-v3-filter-builder";
import {TimeEntryResource} from "core-app/modules/hal/resources/time-entry-resource";
import {TimezoneService} from "core-components/datetime/timezone.service";
import {CollectionResource} from "core-app/modules/hal/resources/collection-resource";
import {TimeEntryCacheService} from "core-components/time-entries/time-entry-cache.service";
import interactionPlugin from '@fullcalendar/interaction';
import {HalResourceEditingService} from "core-app/modules/fields/edit/services/hal-resource-editing.service";
import {TimeEntryEditService} from "core-app/modules/time_entries/edit/edit.service";
import {TimeEntryCreateService} from "core-app/modules/time_entries/create/create.service";
import {ColorsService} from "core-app/modules/common/colors/colors.service";


interface CalendarViewEvent {
  el:HTMLElement;
  event:EventApi;
  jsEvent:MouseEvent;
}

interface CalendarDateClickEvent {
  date:Date;
}

interface CalendarMoveEvent {
  el:HTMLElement;
  event:EventApi;
  oldEvent:EventApi;
  delta:Duration;
  revert:() => void;
  jsEvent:Event;
  view:View;
}

@Component({
  templateUrl: './te-calendar.template.html',
  styleUrls: ['./te-calendar.component.sass'],
  selector: 'te-calendar',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    TimeEntryEditService,
    TimeEntryCreateService,
    HalResourceEditingService
  ]
})
export class TimeEntryCalendarComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild(FullCalendarComponent, { static: false }) ucCalendar:FullCalendarComponent;
  @Input() projectIdentifier:string;
  @Input() static:boolean = false;
  @Output() entries = new EventEmitter<CollectionResource<TimeEntryResource>>();

  public calendarPlugins = [timeGrid, interactionPlugin];
  public calendarEvents:Function;
  public calendarHeader:ToolbarInput|boolean = {
    right: '',
    center: 'title',
    left: 'prev,next today'
  };
  public calendarSlotLabelFormat = (info:any) => 24 - info.date.hour;
  public calendarScrollTime = '24:00:00';
  public calendarContentHeight = 545;
  public calendarAllDaySlot = false;
  public calendarAllDayText = '';
  public calendarDisplayEventTime = false;
  public calendarSlotEventOverlap = false;
  public calendarEditable = false;
  public calendarEventOverlap = (stillEvent:any) => stillEvent.classNames.includes('te-calendar--day-sum');

  protected memoizedTimeEntries:{start:Date, end:Date, entries:Promise<CollectionResource<TimeEntryResource>>};
  protected memoizedCreateAllowed:boolean = false;

  constructor(readonly states:States,
              readonly timeEntryDm:TimeEntryDmService,
              readonly $state:StateService,
              private element:ElementRef,
              readonly i18n:I18nService,
              readonly injector:Injector,
              readonly notificationsService:NotificationsService,
              private sanitizer:DomSanitizer,
              private configuration:ConfigurationService,
              private timezone:TimezoneService,
              private timeEntryEdit:TimeEntryEditService,
              private timeEntryCreate:TimeEntryCreateService,
              private timeEntryCache:TimeEntryCacheService,
              private colors:ColorsService) { }

  ngOnInit() {
    this.initializeCalendar();
  }

  ngOnDestroy() {
    // nothing to do
  }

  ngAfterViewInit() {
    // The full-calendar component's outputs do not seem to work
    // see: https://github.com/fullcalendar/fullcalendar-angular/issues/228#issuecomment-523505044
    // Therefore, setting the outputs via the underlying API
    this.ucCalendar.getApi().setOption('eventRender', (event:CalendarViewEvent) => { this.addTooltip(event); });
    this.ucCalendar.getApi().setOption('eventClick', (event:CalendarViewEvent) => { this.dispatchEventClick(event); });
    this.ucCalendar.getApi().setOption('eventDrop', (event:CalendarMoveEvent) => { this.moveEvent(event); });
    this.ucCalendar.getApi().setOption('dateClick', (event:CalendarDateClickEvent) => { this.addEvent(moment(event.date)); });
  }

  public calendarEventsFunction(fetchInfo:{ start:Date, end:Date },
                                successCallback:(events:EventInput[]) => void,
                                failureCallback:(error:EventSourceError) => void ):void | PromiseLike<EventInput[]> {

    this.fetchTimeEntries(fetchInfo.start, fetchInfo.end)
      .then((collection) => {
        this.entries.emit(collection);

        successCallback(this.buildEntries(collection.elements, fetchInfo));
      });
  }

  protected fetchTimeEntries(start:Date, end:Date) {
    if (!this.memoizedTimeEntries ||
        this.memoizedTimeEntries.start.getTime() !== start.getTime() ||
        this.memoizedTimeEntries.end.getTime() !== end.getTime()) {
      let promise = this
        .timeEntryDm
        .list({ filters: this.dmFilters(start, end) })
        .then(collection => {
          this.memoizedCreateAllowed = !!collection.createTimeEntry;

          collection.elements.forEach(timeEntry => this.timeEntryCache.updateValue(timeEntry.id!, timeEntry));

          return collection;
        });

      this.memoizedTimeEntries = { start: start, end: end, entries: promise };
    }

    return this.memoizedTimeEntries.entries;
  }

  private buildEntries(entries:TimeEntryResource[], fetchInfo:{ start:Date, end:Date }) {
    return this.buildTimeEntryEntries(entries)
      .concat(this.buildAuxEntries(entries, fetchInfo));
  }

  private buildTimeEntryEntries(entries:TimeEntryResource[]) {
    let hoursDistribution:{ [key:string]:Moment } = {};

    return entries.map((entry) => {
      let start:Moment;
      let end:Moment;
      let hours = this.timezone.toHours(entry.hours);

      if (hoursDistribution[entry.spentOn]) {
        start = hoursDistribution[entry.spentOn].clone().subtract(hours, 'h');
        end = hoursDistribution[entry.spentOn].clone();
      } else {
        start = moment(entry.spentOn).add(24 - hours, 'h');
        end = moment(entry.spentOn).add(24, 'h');
      }

      hoursDistribution[entry.spentOn] = start;

      const color = this.colors.forString(this.entryName(entry));

      return {
        title: hours < 0.5 ? '' : this.entryName(entry),
        startEditable: !!entry.update,
        start: start.format(),
        end: end.format(),
        backgroundColor: color,
        borderColor: color,
        entry: entry
      };
    }) as EventInput[];
  }

  private buildAuxEntries(entries:TimeEntryResource[], fetchInfo:{ start:Date, end:Date }) {
    let dateSums:{ [key:string]:number } = {};

    entries.forEach((entry) => {
      let hours = this.timezone.toHours(entry.hours);

      if (dateSums[entry.spentOn]) {
        dateSums[entry.spentOn] += hours;
      } else {
        dateSums[entry.spentOn] = hours;
      }
    });

    let calendarEntries:EventInput[] = [];

    for (let m = moment(fetchInfo.start); m.diff(fetchInfo.end, 'days') <= 0; m.add(1, 'days')) {
      let duration = dateSums[m.format('YYYY-MM-DD')] || 0;

      calendarEntries.push(this.sumEntry(m, duration));

      if (this.memoizedCreateAllowed && duration < 24) {
        calendarEntries.push(this.addEntry(m, duration));
      }
    }

    return calendarEntries;
  }

  protected sumEntry(date:Moment, duration:number) {
    return {
      title: this.i18n.t('js.units.hour', { count: this.formatNumber(duration) }),
      start: date.clone().add(24 - Math.min(duration, 23.5) - 0.5, 'h').format(),
      end: date.clone().add(24 - Math.min(duration, 23.5), 'h').format(),
      classNames: 'te-calendar--day-sum'
    };
  }

  protected addEntry(date:Moment, duration:number) {
    return {
      title: '+',
      start: date.clone().format(),
      end: date.clone().add(24 - Math.min(duration, 22.5) - 0.5, 'h').format(),
      classNames: 'te-calendar--day-add'
    };
  }

  protected dmFilters(start:Date, end:Date):Array<[string, FilterOperator, string[]]> {
    let startDate = moment(start).format('YYYY-MM-DD');
    let endDate = moment(end).subtract(1, 'd').format('YYYY-MM-DD');
    return [['spentOn', '<>d', [startDate, endDate]] as [string, FilterOperator, string[]],
           ['user_id', '=', ['me']] as [string, FilterOperator, [string]]];
  }

  private initializeCalendar() {
    this.calendarEvents = this.calendarEventsFunction.bind(this);
  }

  public get calendarEventLimit() {
    return false;
  }

  public get calendarLocale() {
    return this.i18n.locale;
  }

  public get calendarFixedWeekCount() {
    return false;
  }

  public get calendarDefaultView() {
    return 'timeGridWeek';
  }

  public get calendarFirstDay() {
    return this.configuration.startOfWeek();
  }

  private get calendarElement() {
    return jQuery(this.element.nativeElement).find('.fc-view-container');
  }

  private dispatchEventClick(event:CalendarViewEvent) {
    if (event.event.extendedProps.entry) {
      this.editEvent(event.event.extendedProps.entry);
    } else if (event.event.start) {
      this.addEvent(moment(event.event.start));
    }
  }

  private editEvent(entry:TimeEntryResource) {
    this
      .timeEntryEdit
      .edit(entry)
      .then(modificationAction => {
        this.updateEventSet(modificationAction.entry, modificationAction.action);
      })
      .catch(() => {
        // do nothing, the user closed without changes
      });
  }

  private moveEvent(event:CalendarMoveEvent) {
    let entry = event.event.extendedProps.entry;

    entry.spentOn = moment(event.event.start!).format('YYYY-MM-DD');

    this
      .timeEntryDm
      .update(entry, entry.schema)
      .then(event => {
        this.updateEventSet(event, 'update');
      })
      .catch(() => {
        event.revert();
      });
  }

  private addEvent(date:Moment) {
    if (!this.memoizedCreateAllowed) {
      return;
    }

    this
      .timeEntryCreate
      .create(date)
      .then(modificationAction => {
        this.updateEventSet(modificationAction.entry, modificationAction.action);
      })
      .catch(() => {
        // do nothing, the user closed without changes
      });
  }

  private updateEventSet(event:TimeEntryResource, action:'update'|'destroy'|'create') {
    this.memoizedTimeEntries.entries.then(collection => {
      let foundIndex = collection.elements.findIndex(x => x.id === event.id);

      switch (action) {
        case 'update':
          collection.elements[foundIndex] = event;
          break;
        case 'destroy':
          collection.elements.splice(foundIndex, 1);
          break;
        case 'create':
          collection.elements.push(event);
          break;
      }

      this.ucCalendar.getApi().refetchEvents();
    });
  }

  private addTooltip(event:CalendarViewEvent) {
    if (!event.event.extendedProps.entry) {
      return;
    }

    jQuery(event.el).tooltip({
      content: this.tooltipContentString(event.event.extendedProps.entry),
      items: '.fc-event',
      close: function () { jQuery(".ui-helper-hidden-accessible").remove(); },
      track: true
    });
  }

  private entryName(entry:TimeEntryResource) {
    let name = entry.project.name;
    if (entry.workPackage) {
      name +=  ` - ${this.workPackageName(entry)}`;
    }

    return this.sanitizedValue(name) || '-';
  }

  private workPackageName(entry:TimeEntryResource) {
    return `#${entry.workPackage.idFromLink}: ${entry.workPackage.name}`;
  }

  private tooltipContentString(entry:TimeEntryResource) {
    return `
        <ul class="tooltip--map">
          <li class="tooltip--map--item">
            <span class="tooltip--map--key">${this.i18n.t('js.time_entry.project')}:</span>
            <span class="tooltip--map--value">${this.sanitizedValue(entry.project.name)}</span>
          </li>
          <li class="tooltip--map--item">
            <span class="tooltip--map--key">${this.i18n.t('js.time_entry.work_package')}:</span>
            <span class="tooltip--map--value">${entry.workPackage ? this.sanitizedValue(this.workPackageName(entry)) : this.i18n.t('js.placeholders.default')}</span>
          </li>
          <li class="tooltip--map--item">
            <span class="tooltip--map--key">${this.i18n.t('js.time_entry.activity')}:</span>
            <span class="tooltip--map--value">${this.sanitizedValue(entry.activity.name)}</span>
          </li>
          <li class="tooltip--map--item">
            <span class="tooltip--map--key">${this.i18n.t('js.time_entry.duration')}:</span>
            <span class="tooltip--map--value">${this.timezone.formattedDuration(entry.hours)}</span>
          </li>
          <li class="tooltip--map--item">
            <span class="tooltip--map--key">${this.i18n.t('js.time_entry.comment')}:</span>
            <span class="tooltip--map--value">${entry.comment.raw || this.i18n.t('js.placeholders.default')}</span>
          </li>
        `;
  }

  private sanitizedValue(value:string) {
    return this.sanitizer.sanitize(SecurityContext.HTML, value);
  }

  protected formatNumber(value:number):string {
    return this.i18n.toNumber(value, { precision: 2 });
  }
}
